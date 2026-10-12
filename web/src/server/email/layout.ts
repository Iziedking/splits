/**
 * Every Splits email, in one layout: the logo above a white card with a thin teal edge, a small
 * label naming what this is, the title, and then whichever of these the message needs: the amount
 * set large, a details table, a sign-in code, paragraphs and a button. A plain text part carries
 * the same content. The logo is a PNG served by the app itself (many mail clients don't show SVG);
 * without the app's address the wordmark is set in text. Tables and inline styles only: mail
 * clients ignore style sheets and most layout CSS.
 */
export const LOGO_PATH = "/brand/logo-email.png";

const TEAL = "#0FA39A";
const TEAL_DEEP = "#0A7A73";
const INK = "#0E1C2B";
const SLATE = "#5B6B78";
const MIST = "#F3F7F8";
const LINE = "#E3EBEE";
const FONT = "Manrope, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

export type BrandedEmail = {
  title: string;
  body: string[];
  button?: { label: string; url: string };
  footer?: string;
  appUrl?: string;
  /** A small label above the title: "Payment landed", "Money received". */
  eyebrow?: string;
  /** The amount this email is about, shown large: "$50.75". */
  amount?: string;
  /** Label and value pairs under the amount: From, For, Network, People paid. */
  details?: [string, string][];
  /** A one-time sign-in code, shown spaced out in its own box. */
  code?: string;
  /** The line inboxes show next to the subject. */
  preheader?: string;
};

export function brandedEmail(e: BrandedEmail): { html: string; text: string } {
  const { title, body, button, footer, appUrl, eyebrow, amount, details, code, preheader } = e;
  const url = button ? safeUrl(button.url) : null;
  const base = appUrl ? safeUrl(appUrl.replace(/\/+$/, "")) : null;

  const mark = base
    ? `<img src="${escape(base + LOGO_PATH)}" alt="Splits" width="120" height="37" style="display:block;border:0;height:37px;width:120px">`
    : `<span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${TEAL}">Splits</span>`;
  const label = eyebrow
    ? `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TEAL_DEEP}">${escape(eyebrow)}</p>`
    : "";
  const heading = `<h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-0.01em;color:${INK}">${escape(title)}</h1>`;
  const big = amount
    ? `<p style="margin:18px 0 0;font-size:44px;line-height:1;font-weight:800;letter-spacing:-0.02em;color:${INK}">${escape(amount)}</p>`
    : "";
  const codeBox = code
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="background:${MIST};border:1px solid ${LINE};border-radius:16px;padding:16px 26px;font-size:34px;font-weight:800;letter-spacing:0.32em;color:${INK};font-family:'SFMono-Regular',Menlo,Consolas,monospace">${escape(code)}</td></tr></table>`
    : "";
  const rows = details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border-top:1px solid ${LINE}">` +
      details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${SLATE}">${escape(k)}</td>` +
            `<td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;font-weight:700;color:${INK}">${escape(v)}</td></tr>`,
        )
        .join("") +
      `</table>`
    : "";
  const paragraphs = body.map((p) => `<p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:${INK}">${escape(p)}</p>`).join("");
  // A table button: the whole pill is clickable in Outlook and Gmail alike.
  const cta = url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px"><tr><td style="border-radius:999px;background:${TEAL}">` +
      `<a href="${escape(url)}" style="display:inline-block;padding:15px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${escape(button!.label)}&nbsp;&rarr;</a>` +
      `</td></tr></table>`
    : "";
  const foot = escape(footer ?? "You're getting this because you use Splits. Splits moves USDC on Arc.");
  const links = base
    ? `<p style="margin:10px 0 0;font-size:12px;color:${SLATE}"><a href="${escape(base)}" style="color:${TEAL_DEEP};text-decoration:none;font-weight:700">mysplits.xyz</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${escape(base + "/about")}" style="color:${SLATE};text-decoration:underline">About Splits</a></p>`
    : "";
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escape(preheader)}</div>`
    : "";

  const html =
    `<!doctype html><html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>` +
    `<body style="margin:0;padding:0;background:${MIST}">${hidden}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MIST};font-family:${FONT}">` +
    `<tr><td align="center" style="padding:36px 16px 40px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">` +
    `<tr><td style="padding:0 4px 22px">${mark}</td></tr>` +
    `<tr><td style="background:#ffffff;border-radius:24px;border-top:4px solid ${TEAL};box-shadow:0 18px 40px -24px rgba(14,28,43,0.35);padding:34px 32px 36px">` +
    `${label}${heading}${big}${codeBox}${rows}${paragraphs}${cta}` +
    `</td></tr>` +
    `<tr><td style="padding:22px 6px 0;font-size:12px;line-height:1.6;color:${SLATE}">` +
    `<p style="margin:0;font-weight:700;color:${INK}">Splits · Money home, already divided.</p>` +
    `<p style="margin:6px 0 0">${foot}</p>${links}</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const text = [
    title,
    ...(amount ? [amount] : []),
    ...(code ? [code] : []),
    ...(details?.length ? [details.map(([k, v]) => `${k}: ${v}`).join("\n")] : []),
    ...body,
    ...(url ? [`${button!.label}: ${url}`] : []),
  ].join("\n\n");
  return { html, text };
}
