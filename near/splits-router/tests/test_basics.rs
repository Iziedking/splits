//! Sandbox tests: a real NEAR node, a real NEP-141 token (TEST DOLLAR) and the router, talking to
//! each other through `ft_transfer_call`, so refunds and failed parts behave exactly as on chain.

use near_api::{AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;

const SUPPLY: u128 = 1_000_000_000_000; // 1,000,000.00 TEST DOLLAR
const TEN: u128 = 10_000_000; // 10.00

struct World {
    net: NetworkConfig,
    signer: Arc<Signer>,
    usd: AccountId,
    fake: AccountId,
    router: AccountId,
    payer: AccountId,
    ada: AccountId,
    bo: AccountId,
    cy: AccountId,
    unregistered: AccountId,
}

impl World {
    async fn call(
        &self,
        signer: &AccountId,
        contract: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> testresult::TestResult<()> {
        near_api::Contract(contract.clone())
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(300))
            .with_signer(signer.clone(), self.signer.clone())
            .send_to(&self.net)
            .await?
            .assert_success();
        Ok(())
    }

    async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(
        &self,
        contract: &AccountId,
        method: &str,
        args: Value,
    ) -> testresult::TestResult<T> {
        Ok(near_api::Contract(contract.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await?
            .data)
    }

    async fn balance(&self, token: &AccountId, who: &AccountId) -> testresult::TestResult<u128> {
        let b: U128 = self.view(token, "ft_balance_of", json!({ "account_id": who })).await?;
        Ok(b.0)
    }

    async fn balances(&self) -> testresult::TestResult<[u128; 5]> {
        Ok([
            self.balance(&self.usd, &self.payer).await?,
            self.balance(&self.usd, &self.ada).await?,
            self.balance(&self.usd, &self.bo).await?,
            self.balance(&self.usd, &self.cy).await?,
            self.balance(&self.usd, &self.router).await?,
        ])
    }

    /// The payer sends `amount` of `token` to the router with `msg`.
    async fn pay(&self, token: &AccountId, amount: u128, msg: Value) -> testresult::TestResult<()> {
        self.call(
            &self.payer,
            token,
            "ft_transfer_call",
            json!({ "receiver_id": self.router, "amount": U128(amount), "msg": msg.to_string() }),
            NearToken::from_yoctonear(1),
        )
        .await
    }

    async fn register(&self, token: &AccountId, who: &AccountId) -> testresult::TestResult<()> {
        self.call(
            &self.payer,
            token,
            "storage_deposit",
            json!({ "account_id": who, "registration_only": true }),
            NearToken::from_millinear(10),
        )
        .await
    }
}

async fn create(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox
        .create_account(id.as_str().parse()?)
        .initial_balance(NearToken::from_near(20))
        .send()
        .await?;
    Ok(id)
}

async fn deploy(
    net: &NetworkConfig,
    signer: &Arc<Signer>,
    id: &AccountId,
    wasm: Vec<u8>,
    args: Value,
) -> testresult::TestResult<()> {
    near_api::Contract::deploy(id.clone())
        .use_code(wasm)
        .with_init_call("new", args)?
        .with_signer(signer.clone())
        .send_to(net)
        .await?
        .assert_success();
    Ok(())
}

fn build(manifest: Option<&str>) -> testresult::TestResult<Vec<u8>> {
    let opts = match manifest {
        Some(path) => cargo_near_build::BuildOpts::builder().manifest_path(path).build(),
        None => Default::default(),
    };
    let path = cargo_near_build::build_with_cli(opts)?;
    Ok(std::fs::read(path)?)
}

#[tokio::test]
async fn split_payments_on_a_real_token() -> testresult::TestResult<()> {
    let router_wasm = build(None)?;
    let token_wasm = build(Some("../test-token/Cargo.toml"))?;

    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse().unwrap(),
    )?;

    let w = World {
        usd: create(&sandbox, "usd.sandbox").await?,
        fake: create(&sandbox, "fake.sandbox").await?,
        router: create(&sandbox, "router.sandbox").await?,
        payer: create(&sandbox, "payer.sandbox").await?,
        ada: create(&sandbox, "ada.sandbox").await?,
        bo: create(&sandbox, "bo.sandbox").await?,
        cy: create(&sandbox, "cy.sandbox").await?,
        unregistered: create(&sandbox, "unregistered.sandbox").await?,
        net,
        signer,
    };

    for token in [&w.usd, &w.fake] {
        deploy(&w.net, &w.signer, token, token_wasm.clone(),
            json!({ "owner_id": w.payer, "total_supply": U128(SUPPLY) })).await?;
    }
    deploy(&w.net, &w.signer, &w.router, router_wasm, json!({ "tokens": [w.usd] })).await?;

    for who in [&w.router, &w.ada, &w.bo, &w.cy] {
        w.register(&w.usd, who).await?;
    }
    w.register(&w.fake, &w.router).await?;

    // 1. A split of 10.00 between three people lands in full, and the router keeps nothing.
    let legs = json!([
        { "account_id": w.ada, "amount": "5000000", "purpose": "rent" },
        { "account_id": w.bo, "amount": "3000000", "purpose": "groceries" },
        { "account_id": w.cy, "amount": "2000000", "purpose": "transport" },
    ]);
    w.pay(&w.usd, TEN, json!({ "ref": "r1", "legs": legs })).await?;
    assert_eq!(w.balances().await?, [SUPPLY - TEN, 5_000_000, 3_000_000, 2_000_000, 0]);
    let used: bool = w.view(&w.router, "is_ref_used", json!({ "payer": w.payer, "reference": "r1" })).await?;
    assert!(used);

    // 2. The same ref again pays nothing; the payer gets everything back.
    let before = w.balances().await?;
    w.pay(&w.usd, TEN, json!({ "ref": "r1", "legs": legs })).await?;
    assert_eq!(w.balances().await?, before, "a repeated ref must pay nothing");

    // 3. Legs that do not add up: full refund.
    let short = json!([{ "account_id": w.ada, "amount": "9000000", "purpose": "rent" }]);
    w.pay(&w.usd, TEN, json!({ "ref": "r3", "legs": short })).await?;
    assert_eq!(w.balances().await?, before);

    // 4. A msg that is not JSON: full refund.
    near_api::Contract(w.usd.clone())
        .call_function("ft_transfer_call", json!({ "receiver_id": w.router, "amount": U128(TEN), "msg": "pay ada" }))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .gas(NearGas::from_tgas(300))
        .with_signer(w.payer.clone(), w.signer.clone())
        .send_to(&w.net)
        .await?
        .assert_success();
    assert_eq!(w.balances().await?, before);

    // 5. A token that is not on the allow list: full refund of that token.
    let fake_before = w.balance(&w.fake, &w.payer).await?;
    w.pay(&w.fake, TEN, json!({ "ref": "r5", "legs": [{ "account_id": w.ada, "amount": "10000000", "purpose": "rent" }] })).await?;
    assert_eq!(w.balance(&w.fake, &w.payer).await?, fake_before);
    assert_eq!(w.balance(&w.fake, &w.router).await?, 0);

    // 6. One recipient is not registered with the token: that part comes back to the payer, the
    //    others land.
    let mixed = json!([
        { "account_id": w.ada, "amount": "4000000", "purpose": "rent" },
        { "account_id": w.unregistered, "amount": "6000000", "purpose": "deposit" },
    ]);
    w.pay(&w.usd, TEN, json!({ "ref": "r6", "legs": mixed })).await?;
    let after = w.balances().await?;
    assert_eq!(after[0], before[0] - 4_000_000, "payer pays only the part that landed");
    assert_eq!(after[1], before[1] + 4_000_000);
    assert_eq!(after[4], 0, "router keeps nothing");
    assert_eq!(w.balance(&w.usd, &w.unregistered).await?, 0);

    // 7. "Auto-split my income into tax, savings and spending": Ada saves a split, and a client's
    //    payment to Ada divides itself on arrival.
    w.call(&w.ada, &w.router, "set_split", json!({ "shares": [
        { "account_id": w.cy, "bps": 3000, "purpose": "tax" },
        { "account_id": w.bo, "bps": 2000, "purpose": "savings" },
        { "account_id": w.ada, "bps": 5000, "purpose": "spending" },
    ]}), NearToken::from_millinear(100)).await?;
    let before = w.balances().await?;
    w.pay(&w.usd, TEN, json!({ "ref": "inv-1", "to": w.ada, "version": 1 })).await?;
    let after = w.balances().await?;
    assert_eq!(after[0], before[0] - TEN);
    assert_eq!(after[1], before[1] + 5_000_000, "spending");
    assert_eq!(after[2], before[2] + 2_000_000, "savings");
    assert_eq!(after[3], before[3] + 3_000_000, "tax");
    assert_eq!(after[4], 0);

    // 8. Ada changes her split. A payer who saw version 1 is refunded in full.
    w.call(&w.ada, &w.router, "set_split", json!({ "shares": [
        { "account_id": w.ada, "bps": 10000, "purpose": "spending" },
    ]}), NearToken::from_millinear(100)).await?;
    let before = w.balances().await?;
    w.pay(&w.usd, TEN, json!({ "ref": "inv-2", "to": w.ada, "version": 1 })).await?;
    assert_eq!(w.balances().await?, before, "a stale split version must pay nothing");

    Ok(())
}
