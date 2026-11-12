//! Splits router for NEAR.
//!
//! One fungible-token payment, divided between named accounts, with a purpose on every part.
//!
//! How money moves:
//! 1. The payer calls `ft_transfer_call` on an allowed token with this contract as `receiver_id`
//!    and a JSON `msg` that either lists the parts (`legs`) or names an account whose saved split
//!    should divide the money (`to` + `version`).
//! 2. `ft_on_transfer` checks the message. If anything is wrong it returns the whole amount as
//!    unused, and the token contract refunds the payer.
//! 3. Otherwise the router sends each part with `ft_transfer` and joins the results in
//!    `on_payout`. A part that fails (for example, the recipient is not registered with the
//!    token) is counted as unused, so the token contract refunds exactly that part to the payer.
//!
//! Differences from Splits on Arc, stated plainly:
//! - NEAR contracts call each other asynchronously, so the parts are not atomic. Some parts can
//!   land while another is refunded. Every outcome is recorded in an event.
//! - The router holds the money between receiving it and paying it out (a few blocks).
//!
//! There is no owner: no admin method, no upgrade method, no rescue method. The token allow list
//! is fixed when the contract is initialised.

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env,
    near, require,
};

/// Basis points in a whole: saved splits must add up to exactly this.
pub const BPS_TOTAL: u32 = 10_000;
/// Most parts in one payment. Each part is one cross-contract call, and a transaction has
/// 300 TGas at most. Bigger payrolls are sent as several payments.
pub const MAX_LEGS: usize = 10;
/// Smallest payment the router accepts, in the token's smallest unit (0.01 of a 6-decimal
/// stablecoin). Each payment stores its reference on chain, so dust payments are refused to
/// keep that storage from being spammed.
pub const MIN_TOTAL: u128 = 10_000;
pub const MAX_REF_LEN: usize = 64;
pub const MAX_PURPOSE_LEN: usize = 140;

const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_PAYOUT_BASE: Gas = Gas::from_tgas(10);
const GAS_FOR_PAYOUT_PER_LEG: Gas = Gas::from_tgas(2);
/// Gas `ft_on_transfer` needs for its own work before the parts go out.
const GAS_FOR_ON_TRANSFER: Gas = Gas::from_tgas(15);

const EVENT_STANDARD: &str = "splits";
const EVENT_VERSION: &str = "1.0.0";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Tokens,
    UsedRefs,
    Splits,
}

/// One part of a payment.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Leg {
    pub account_id: AccountId,
    pub amount: U128,
    pub purpose: String,
}

/// One part of a saved split, as a share in basis points.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Share {
    pub account_id: AccountId,
    pub bps: u32,
    pub purpose: String,
}

/// A split an account has saved for itself. Every payment sent to that account through the
/// router is divided by it.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SavedSplit {
    pub version: u32,
    pub shares: Vec<Share>,
}

/// The `msg` a payer puts in `ft_transfer_call`.
#[derive(Deserialize, Serialize, Debug)]
#[serde(crate = "near_sdk::serde", untagged, deny_unknown_fields)]
pub enum PayMsg {
    /// Pay the listed parts. They must add up to the amount sent.
    Legs {
        #[serde(rename = "ref")]
        reference: String,
        legs: Vec<Leg>,
    },
    /// Pay `to` through the split it saved. `version` is the version the payer saw.
    Saved {
        #[serde(rename = "ref")]
        reference: String,
        to: AccountId,
        version: u32,
    },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SplitsRouter {
    tokens: LookupSet<AccountId>,
    token_list: Vec<AccountId>,
    /// sha256(payer || 0x00 || ref) for every payment that was accepted.
    used_refs: LookupSet<[u8; 32]>,
    splits: LookupMap<AccountId, SavedSplit>,
}

#[near]
impl SplitsRouter {
    /// Set the token allow list. Only the contract account itself can call this, once, normally
    /// in the same transaction as the deploy. The list cannot change afterwards.
    #[init]
    #[private]
    pub fn new(tokens: Vec<AccountId>) -> Self {
        require!(!tokens.is_empty(), "Give at least one token");
        let mut set = LookupSet::new(StorageKey::Tokens);
        let mut list = Vec::new();
        for token in tokens {
            if !set.contains(&token) {
                set.insert(token.clone());
                list.push(token);
            }
        }
        Self {
            tokens: set,
            token_list: list,
            used_refs: LookupSet::new(StorageKey::UsedRefs),
            splits: LookupMap::new(StorageKey::Splits),
        }
    }

    // ---------------------------------------------------------------- views

    pub fn tokens(&self) -> Vec<AccountId> {
        self.token_list.clone()
    }

    pub fn get_split(&self, account_id: AccountId) -> Option<SavedSplit> {
        self.splits.get(&account_id).cloned()
    }

    pub fn is_ref_used(&self, payer: AccountId, reference: String) -> bool {
        self.used_refs.contains(&ref_key(&payer, &reference))
    }

    /// What a payment of `amount` to `account_id` would pay each part right now.
    pub fn preview_saved(&self, account_id: AccountId, amount: U128) -> Option<Vec<Leg>> {
        self.splits
            .get(&account_id)
            .map(|split| divide_by_shares(amount.0, &split.shares))
    }

    // ---------------------------------------------------------------- saved splits

    /// Save (or replace) the caller's own split. Shares are in basis points and must total
    /// 10,000. The caller pays for the storage it uses; anything attached beyond that is
    /// returned. Each save bumps the version, so payers who saw an older version are refused.
    #[payable]
    pub fn set_split(&mut self, shares: Vec<Share>) -> SavedSplit {
        let owner = env::predecessor_account_id();
        if let Err(reason) = check_shares(&shares) {
            env::panic_str(reason);
        }
        let before = env::storage_usage();
        let version = self.splits.get(&owner).map_or(1, |s| s.version + 1);
        let split = SavedSplit { version, shares };
        self.splits.insert(owner.clone(), split.clone());
        self.splits.flush();
        let after = env::storage_usage();

        let cost = env::storage_byte_cost().saturating_mul(after.saturating_sub(before).into());
        let attached = env::attached_deposit();
        require!(
            attached >= cost,
            format!("Attach at least {} yoctoNEAR to pay for storage", cost.as_yoctonear())
        );
        let excess = attached.saturating_sub(cost);
        if !excess.is_zero() {
            let _ = Promise::new(owner.clone()).transfer(excess);
        }
        emit(
            "split_saved",
            json!({ "owner": owner, "version": split.version, "shares": split.shares }),
        );
        split
    }

    // ---------------------------------------------------------------- receiving money

    /// NEP-141 receiver. Returns the amount the token contract must give back to the payer.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        match self.accept(&token, &sender_id, amount.0, &msg) {
            Ok((reference, split_owner, legs)) => {
                PromiseOrValue::Promise(pay_out(token, sender_id, reference, split_owner, legs))
            }
            Err(reason) => {
                emit(
                    "payment_refused",
                    json!({
                        "payer": sender_id,
                        "token": token,
                        "amount": amount,
                        "reason": reason,
                    }),
                );
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// Joins the results of every `ft_transfer` and returns the total that did not land, which
    /// the token contract then refunds to the payer. Never panics: a panic here would refund
    /// parts that were already paid.
    #[private]
    pub fn on_payout(
        &mut self,
        payer: AccountId,
        token: AccountId,
        reference: String,
        split_owner: Option<AccountId>,
        legs: Vec<Leg>,
    ) -> U128 {
        let mut paid: u128 = 0;
        let mut refunded: u128 = 0;
        let mut outcome = Vec::with_capacity(legs.len());
        for (index, leg) in legs.iter().enumerate() {
            let landed = leg_landed(index as u64);
            let event = if landed { "leg_paid" } else { "leg_refunded" };
            if landed {
                paid += leg.amount.0;
            } else {
                refunded += leg.amount.0;
            }
            emit(
                event,
                json!({
                    "payer": payer,
                    "token": token,
                    "ref": reference,
                    "split_owner": split_owner,
                    "recipient": leg.account_id,
                    "amount": leg.amount,
                    "purpose": leg.purpose,
                }),
            );
            outcome.push(json!({
                "recipient": leg.account_id,
                "amount": leg.amount,
                "purpose": leg.purpose,
                "landed": landed,
            }));
        }
        emit(
            "payment",
            json!({
                "payer": payer,
                "token": token,
                "ref": reference,
                "split_owner": split_owner,
                "total": U128(paid + refunded),
                "paid": U128(paid),
                "refunded": U128(refunded),
                "legs": outcome,
            }),
        );
        U128(refunded)
    }
}

impl SplitsRouter {
    /// Every check before money moves. On success the reference is marked used.
    fn accept(
        &mut self,
        token: &AccountId,
        payer: &AccountId,
        amount: u128,
        msg: &str,
    ) -> Result<(String, Option<AccountId>, Vec<Leg>), &'static str> {
        if !self.tokens.contains(token) {
            return Err("token_not_allowed");
        }
        if amount < MIN_TOTAL {
            return Err("amount_too_small");
        }
        let parsed: PayMsg = serde_json::from_str(msg).map_err(|_| "bad_msg")?;
        let (reference, split_owner, legs) = match parsed {
            PayMsg::Legs { reference, legs } => {
                check_legs(&legs, amount)?;
                (reference, None, legs)
            }
            PayMsg::Saved { reference, to, version } => {
                let split = self.splits.get(&to).ok_or("no_saved_split")?;
                if split.version != version {
                    return Err("stale_split_version");
                }
                let legs = divide_by_shares(amount, &split.shares);
                (reference, Some(to), legs)
            }
        };
        check_ref(&reference)?;
        for leg in &legs {
            if leg.account_id == env::current_account_id() {
                return Err("router_cannot_be_recipient");
            }
        }
        let needed = GAS_FOR_ON_TRANSFER
            .saturating_add(GAS_FOR_FT_TRANSFER.saturating_mul(legs.len() as u64))
            .saturating_add(payout_gas(legs.len()));
        if env::prepaid_gas().saturating_sub(env::used_gas()) < needed {
            return Err("not_enough_gas");
        }
        let key = ref_key(payer, &reference);
        if self.used_refs.contains(&key) {
            return Err("ref_already_used");
        }
        self.used_refs.insert(key);
        Ok((reference, split_owner, legs))
    }
}

fn payout_gas(legs: usize) -> Gas {
    GAS_FOR_PAYOUT_BASE.saturating_add(GAS_FOR_PAYOUT_PER_LEG.saturating_mul(legs as u64))
}

fn pay_out(
    token: AccountId,
    payer: AccountId,
    reference: String,
    split_owner: Option<AccountId>,
    legs: Vec<Leg>,
) -> Promise {
    let mut joined: Option<Promise> = None;
    for leg in &legs {
        let args = json!({
            "receiver_id": leg.account_id,
            "amount": leg.amount,
            "memo": leg.purpose,
        });
        let transfer = Promise::new(token.clone()).function_call(
            "ft_transfer".to_string(),
            serde_json::to_vec(&args).unwrap_or_default(),
            NearToken::from_yoctonear(1),
            GAS_FOR_FT_TRANSFER,
        );
        joined = Some(match joined {
            None => transfer,
            Some(all) => all.and(transfer),
        });
    }
    let callback = SplitsRouter::ext(env::current_account_id())
        .with_static_gas(payout_gas(legs.len()))
        .on_payout(payer, token, reference, split_owner, legs);
    // `accept` guarantees at least one leg.
    match joined {
        Some(all) => all.then(callback),
        None => callback,
    }
}

/// `ft_transfer` returns nothing, so success is all that matters. The bound keeps a token that
/// returns a huge value from burning the callback's gas; an oversized reply still means the call
/// succeeded.
fn leg_landed(index: u64) -> bool {
    match env::promise_result_checked(index, 64) {
        Ok(_) => true,
        Err(near_sdk::PromiseError::TooLong(_)) => true,
        Err(_) => false,
    }
}

fn ref_key(payer: &AccountId, reference: &str) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(payer.as_str().len() + 1 + reference.len());
    bytes.extend_from_slice(payer.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(reference.as_bytes());
    env::sha256_array(&bytes)
}

fn check_ref(reference: &str) -> Result<(), &'static str> {
    if reference.is_empty() || reference.len() > MAX_REF_LEN {
        return Err("bad_ref");
    }
    Ok(())
}

fn check_purpose(purpose: &str) -> Result<(), &'static str> {
    let trimmed = purpose.trim();
    if trimmed.is_empty() || purpose.len() > MAX_PURPOSE_LEN {
        return Err("bad_purpose");
    }
    Ok(())
}

/// Parts listed by the payer: no duplicates, no zero amounts, and they add up to `amount`.
pub fn check_legs(legs: &[Leg], amount: u128) -> Result<(), &'static str> {
    if legs.is_empty() {
        return Err("no_legs");
    }
    if legs.len() > MAX_LEGS {
        return Err("too_many_legs");
    }
    let mut sum: u128 = 0;
    for (i, leg) in legs.iter().enumerate() {
        if leg.amount.0 == 0 {
            return Err("zero_amount");
        }
        check_purpose(&leg.purpose)?;
        if legs[..i].iter().any(|other| other.account_id == leg.account_id) {
            return Err("duplicate_recipient");
        }
        sum = sum.checked_add(leg.amount.0).ok_or("legs_do_not_add_up")?;
    }
    if sum != amount {
        return Err("legs_do_not_add_up");
    }
    Ok(())
}

/// Shares saved by an account: no duplicates, each above zero, total exactly 10,000.
pub fn check_shares(shares: &[Share]) -> Result<(), &'static str> {
    if shares.is_empty() {
        return Err("no_shares");
    }
    if shares.len() > MAX_LEGS {
        return Err("too_many_shares");
    }
    let mut total: u32 = 0;
    for (i, share) in shares.iter().enumerate() {
        if share.bps == 0 || share.bps > BPS_TOTAL {
            return Err("bad_share");
        }
        check_purpose(&share.purpose)?;
        if shares[..i].iter().any(|other| other.account_id == share.account_id) {
            return Err("duplicate_recipient");
        }
        total += share.bps;
    }
    if total != BPS_TOTAL {
        return Err("shares_must_total_10000");
    }
    Ok(())
}

/// Divide `amount` by basis-point shares, in whole units of the token.
///
/// Each part gets `floor(amount * bps / 10000)`. What is left over (always fewer units than
/// there are parts) goes one unit at a time to the parts in the order they were saved. This is
/// the same rule Splits uses on Arc. A part that would come to zero is dropped, and its unit of
/// remainder, if any, moves to the next part.
pub fn divide_by_shares(amount: u128, shares: &[Share]) -> Vec<Leg> {
    let mut amounts: Vec<u128> = shares
        .iter()
        .map(|s| amount * u128::from(s.bps) / u128::from(BPS_TOTAL))
        .collect();
    let mut left = amount - amounts.iter().sum::<u128>();
    for part in amounts.iter_mut() {
        if left == 0 {
            break;
        }
        *part += 1;
        left -= 1;
    }
    shares
        .iter()
        .zip(amounts)
        .filter(|(_, value)| *value > 0)
        .map(|(share, value)| Leg {
            account_id: share.account_id.clone(),
            amount: U128(value),
            purpose: share.purpose.clone(),
        })
        .collect()
}

/// Divide `amount` into `parts` equal whole units, extra units to the first parts. 100.00 in
/// cents between 7 gives four parts of 14.29 and three of 14.28.
pub fn divide_equally(amount: u128, parts: u128) -> Vec<u128> {
    if parts == 0 {
        return Vec::new();
    }
    let base = amount / parts;
    let extra = amount % parts;
    (0..parts).map(|i| base + u128::from(i < extra)).collect()
}

/// NEP-297 event log.
fn emit(event: &str, data: serde_json::Value) {
    let log = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{log}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, get_logs};
    use near_sdk::testing_env;

    fn acc(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn router() -> AccountId {
        acc("router.testnet")
    }

    fn usdc() -> AccountId {
        acc("usdc.testnet")
    }

    fn context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(router())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .prepaid_gas(Gas::from_tgas(300));
        builder
    }

    fn setup() -> SplitsRouter {
        testing_env!(context(router()).build());
        let contract = SplitsRouter::new(vec![usdc()]);
        testing_env!(context(usdc()).build());
        contract
    }

    fn leg(name: &str, amount: u128, purpose: &str) -> Leg {
        Leg { account_id: acc(name), amount: U128(amount), purpose: purpose.to_string() }
    }

    fn share(name: &str, bps: u32, purpose: &str) -> Share {
        Share { account_id: acc(name), bps, purpose: purpose.to_string() }
    }

    fn legs_msg(reference: &str, legs: &[Leg]) -> String {
        json!({ "ref": reference, "legs": legs }).to_string()
    }

    fn refunded(result: PromiseOrValue<U128>) -> Option<u128> {
        match result {
            PromiseOrValue::Value(v) => Some(v.0),
            PromiseOrValue::Promise(_) => None,
        }
    }

    fn refused_reason() -> String {
        let logs = get_logs();
        let last = logs.last().expect("an event");
        let body: serde_json::Value =
            serde_json::from_str(last.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        assert_eq!(body["event"], "payment_refused");
        body["data"][0]["reason"].as_str().unwrap().to_string()
    }

    const TEN: u128 = 10_000_000; // 10.00 of a 6-decimal token

    #[test]
    fn valid_payment_goes_out() {
        let mut c = setup();
        let legs = [leg("ada.testnet", 6_000_000, "rent"), leg("bo.testnet", 4_000_000, "food")];
        let out = c.ft_on_transfer(acc("payer.testnet"), U128(TEN), legs_msg("r1", &legs));
        assert_eq!(refunded(out), None);
        assert!(c.is_ref_used(acc("payer.testnet"), "r1".into()));
    }

    #[test]
    fn legs_that_do_not_add_up_are_refunded_in_full() {
        let mut c = setup();
        let legs = [leg("ada.testnet", 6_000_000, "rent"), leg("bo.testnet", 3_000_000, "food")];
        let out = c.ft_on_transfer(acc("payer.testnet"), U128(TEN), legs_msg("r1", &legs));
        assert_eq!(refunded(out), Some(TEN));
        assert_eq!(refused_reason(), "legs_do_not_add_up");
        assert!(!c.is_ref_used(acc("payer.testnet"), "r1".into()));
    }

    #[test]
    fn repeated_ref_from_same_payer_pays_nothing() {
        let mut c = setup();
        let legs = [leg("ada.testnet", TEN, "rent")];
        assert_eq!(refunded(c.ft_on_transfer(acc("payer.testnet"), U128(TEN), legs_msg("r1", &legs))), None);
        let again = c.ft_on_transfer(acc("payer.testnet"), U128(TEN), legs_msg("r1", &legs));
        assert_eq!(refunded(again), Some(TEN));
        assert_eq!(refused_reason(), "ref_already_used");
        // A different payer may use the same ref.
        let other = c.ft_on_transfer(acc("other.testnet"), U128(TEN), legs_msg("r1", &legs));
        assert_eq!(refunded(other), None);
    }

    #[test]
    fn token_not_on_allow_list_is_refunded() {
        let mut c = setup();
        testing_env!(context(acc("fake-usdc.testnet")).build());
        let legs = [leg("ada.testnet", TEN, "rent")];
        let out = c.ft_on_transfer(acc("payer.testnet"), U128(TEN), legs_msg("r1", &legs));
        assert_eq!(refunded(out), Some(TEN));
        assert_eq!(refused_reason(), "token_not_allowed");
    }

    #[test]
    fn msg_that_is_not_json_is_refunded() {
        let mut c = setup();
        let out = c.ft_on_transfer(acc("payer.testnet"), U128(TEN), "pay ada please".into());
        assert_eq!(refunded(out), Some(TEN));
        assert_eq!(refused_reason(), "bad_msg");
    }

    #[test]
    fn duplicates_zero_amounts_and_bad_purposes_are_refused() {
        let cases: Vec<(Vec<Leg>, &str)> = vec![
            (vec![leg("ada.testnet", 5_000_000, "a"), leg("ada.testnet", 5_000_000, "b")], "duplicate_recipient"),
            (vec![leg("ada.testnet", TEN, "a"), leg("bo.testnet", 0, "b")], "zero_amount"),
            (vec![leg("ada.testnet", TEN, "   ")], "bad_purpose"),
            (vec![], "no_legs"),
            (vec![leg("router.testnet", TEN, "loop")], "router_cannot_be_recipient"),
        ];
        for (i, (legs, reason)) in cases.into_iter().enumerate() {
            let mut c = setup();
            let out = c.ft_on_transfer(acc("payer.testnet"), U128(TEN), legs_msg(&format!("r{i}"), &legs));
            assert_eq!(refunded(out), Some(TEN), "case {reason}");
            assert_eq!(refused_reason(), reason);
        }
    }

    #[test]
    fn too_many_legs_and_dust_are_refused() {
        let mut c = setup();
        let legs: Vec<Leg> = (0..11).map(|i| leg(&format!("p{i}.testnet"), 1_000_000, "pay")).collect();
        let out = c.ft_on_transfer(acc("payer.testnet"), U128(11_000_000), legs_msg("r1", &legs));
        assert_eq!(refunded(out), Some(11_000_000));
        assert_eq!(refused_reason(), "too_many_legs");

        let out = c.ft_on_transfer(acc("payer.testnet"), U128(9_999), legs_msg("r2", &[leg("ada.testnet", 9_999, "tip")]));
        assert_eq!(refunded(out), Some(9_999));
        assert_eq!(refused_reason(), "amount_too_small");
    }

    #[test]
    fn not_enough_gas_is_refunded() {
        let mut c = setup();
        testing_env!(context(usdc()).prepaid_gas(Gas::from_tgas(20)).build());
        let out = c.ft_on_transfer(acc("payer.testnet"), U128(TEN), legs_msg("r1", &[leg("ada.testnet", TEN, "rent")]));
        assert_eq!(refunded(out), Some(TEN));
        assert_eq!(refused_reason(), "not_enough_gas");
    }

    #[test]
    fn equal_split_of_100_between_7_in_cents() {
        let parts = divide_equally(10_000, 7);
        assert_eq!(parts, vec![1429, 1429, 1429, 1429, 1428, 1428, 1428]);
        assert_eq!(parts.iter().sum::<u128>(), 10_000);
    }

    #[test]
    fn divide_by_shares_always_adds_up() {
        let shares = [
            share("tax.ada.testnet", 3_000, "tax"),
            share("savings.ada.testnet", 2_000, "savings"),
            share("ada.testnet", 5_000, "spending"),
        ];
        for amount in [10_000u128, 10_001, 10_002, 99_999_999, 1_234_567_891, 7] {
            let legs = divide_by_shares(amount, &shares);
            assert_eq!(legs.iter().map(|l| l.amount.0).sum::<u128>(), amount, "amount {amount}");
        }
        // 100.01 in cents: 3000.3 / 2000.2 / 5000.5 -> floors 3000/2000/5000, one unit left
        // over goes to the first part.
        let legs = divide_by_shares(10_001, &shares);
        assert_eq!(legs.iter().map(|l| l.amount.0).collect::<Vec<_>>(), vec![3001, 2000, 5000]);
        // 100.00 between seven shares of 1429/1428 bps.
        let seven: Vec<Share> = [1429, 1429, 1429, 1429, 1428, 1428, 1428]
            .iter()
            .enumerate()
            .map(|(i, bps)| share(&format!("p{i}.testnet"), *bps, "share"))
            .collect();
        let legs = divide_by_shares(10_000, &seven);
        assert_eq!(
            legs.iter().map(|l| l.amount.0).collect::<Vec<_>>(),
            vec![1429, 1429, 1429, 1429, 1428, 1428, 1428]
        );
    }

    #[test]
    fn saved_split_divides_payment_and_stale_version_is_refused() {
        let mut c = setup();
        testing_env!(context(acc("ada.testnet")).attached_deposit(NearToken::from_millinear(100)).build());
        let saved = c.set_split(vec![
            share("tax.ada.testnet", 3_000, "tax"),
            share("savings.ada.testnet", 2_000, "savings"),
            share("ada.testnet", 5_000, "spending"),
        ]);
        assert_eq!(saved.version, 1);
        let preview = c.preview_saved(acc("ada.testnet"), U128(TEN)).unwrap();
        assert_eq!(preview.iter().map(|l| l.amount.0).collect::<Vec<_>>(), vec![3_000_000, 2_000_000, 5_000_000]);

        testing_env!(context(usdc()).build());
        let msg = json!({ "ref": "inv-1", "to": "ada.testnet", "version": 1 }).to_string();
        assert_eq!(refunded(c.ft_on_transfer(acc("client.testnet"), U128(TEN), msg)), None);

        // Ada changes her split: version 2. A payer still on version 1 is refused.
        testing_env!(context(acc("ada.testnet")).attached_deposit(NearToken::from_millinear(100)).build());
        let saved = c.set_split(vec![share("ada.testnet", 10_000, "spending")]);
        assert_eq!(saved.version, 2);
        testing_env!(context(usdc()).build());
        let msg = json!({ "ref": "inv-2", "to": "ada.testnet", "version": 1 }).to_string();
        assert_eq!(refunded(c.ft_on_transfer(acc("client.testnet"), U128(TEN), msg)), Some(TEN));
        assert_eq!(refused_reason(), "stale_split_version");

        let msg = json!({ "ref": "inv-3", "to": "nobody.testnet", "version": 1 }).to_string();
        assert_eq!(refunded(c.ft_on_transfer(acc("client.testnet"), U128(TEN), msg)), Some(TEN));
        assert_eq!(refused_reason(), "no_saved_split");
    }

    #[test]
    #[should_panic(expected = "shares_must_total_10000")]
    fn shares_that_do_not_total_10000_are_refused() {
        let mut c = setup();
        testing_env!(context(acc("ada.testnet")).attached_deposit(NearToken::from_millinear(100)).build());
        c.set_split(vec![share("tax.ada.testnet", 3_000, "tax"), share("ada.testnet", 6_000, "rest")]);
    }

    #[test]
    #[should_panic(expected = "to pay for storage")]
    fn set_split_without_storage_deposit_is_refused() {
        let mut c = setup();
        testing_env!(context(acc("ada.testnet")).build());
        c.set_split(vec![share("ada.testnet", 10_000, "spending")]);
    }

    #[test]
    #[should_panic(expected = "Give at least one token")]
    fn empty_allow_list_is_refused() {
        testing_env!(context(router()).build());
        SplitsRouter::new(vec![]);
    }
}
