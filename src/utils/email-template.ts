// A simple HTML email for the owner: a heading, a short message, a table of details and
// an optional list, in one centred card with inline styles so it renders the same in
// Gmail, Outlook and phone mail apps. Every value is escaped.

export type OwnerEmail = {
  heading: string;
  intro: string;
  details?: [label: string, value: string][];
  list?: { title: string; items: string[] };
  footer: string;
};

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Renders the owner email as HTML.
export function ownerEmailHtml(email: OwnerEmail) {
  const details = (email.details ?? [])
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 0;color:#6b7280;width:140px;vertical-align:top">${escape(label)}</td>` +
        `<td style="padding:8px 0;color:#111827;font-weight:600">${escape(value)}</td></tr>`,
    )
    .join("");
  const list = email.list?.items.length
    ? `<p style="margin:24px 0 8px;color:#111827;font-weight:600">${escape(email.list.title)}</p>` +
      `<ul style="margin:0;padding-left:20px;color:#111827">${email.list.items.map((item) => `<li style="margin:4px 0">${escape(item)}</li>`).join("")}</ul>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px">
          <tr><td>
            <h1 style="margin:0 0 12px;font-size:20px;color:#111827">${escape(email.heading)}</h1>
            <p style="margin:0 0 16px;color:#374151">${escape(email.intro)}</p>
            ${details ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e5e7eb">${details}</table>` : ""}
            ${list}
            <p style="margin:28px 0 0;color:#9ca3af;font-size:13px">${escape(email.footer)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// The same email as plain text, for mail apps that don't show HTML.
export function ownerEmailText(email: OwnerEmail) {
  return [
    email.intro,
    "",
    ...(email.details ?? []).map(([label, value]) => `${label}: ${value}`),
    ...(email.list?.items.length ? ["", `${email.list.title}:`, ...email.list.items.map((item) => `• ${item}`)] : []),
    "",
    email.footer,
  ].join("\n");
}
