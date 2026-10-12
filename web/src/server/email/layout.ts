/**
 * Every Splits email: the Splits logo (a PNG served by the app itself, since many mail clients
 * don't show SVG), a title, short paragraphs, an optional button, and a plain text part. Without
 * the app's address the wordmark is set in text. Inline styles only: mail clients ignore style sheets.
 */
export const LOGO_PATH = "/brand/logo-email.png";

const TEAL = "#0FA39A";
const INK = "#0E1C2B";
const SLATE = "#5B6B78";
const FONT = "Manrope, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

export type BrandedEmail = { title: string; body: string[]; button?: { label: string; url: string }; footer?: string; appUrl?: string };

export function brandedEmail({ title, body, button, footer, appUrl }: BrandedEmail): { html: string; text: string } {
  const url = button ? safeUrl(button.url) : null;
  const base = appUrl ? safeUrl(appUrl.replace(/\/+$/, "")) : null;
  const mark = base
    ? `<img src="${escape(base + LOGO_PATH)}" alt="Splits" width="120" height="37" style="display:block;border:0;height:37px;width:120px">`
    : `<span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${TEAL}">Splits</span>`;
  const paragraphs = body.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${INK}">${escape(p)}</p>`).join("");
  const cta = url
    ? `<p style="margin:24px 0 8px"><a href="${escape(url)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">${escape(button!.label)}</a></p>`
    : "";
  const foot = escape(footer ?? "You're getting this because you have a Splits account. Splits moves USDC on Arc.");
  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#F3F7F8">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F7F8;font-family:${FONT}">` +
    `<tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px">` +
    `<tr><td style="padding:28px 28px 0">${mark}</td></tr>` +
    `<tr><td style="padding:20px 28px 28px">` +
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${INK}">${escape(title)}</h1>` +
    `${paragraphs}${cta}</td></tr></table>` +
    `<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:${SLATE}">${foot}</p>` +
    `</td></tr></table></body></html>`;
  const text = [title, ...body, ...(url ? [`${button!.label}: ${url}`] : [])].join("\n\n");
  return { html, text };
}
