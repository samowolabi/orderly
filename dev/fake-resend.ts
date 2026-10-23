// Local stand-in for Resend's send-email endpoint, so owner alerts can be tested with
// curl without sending real email.
//
// Control endpoints:
//   GET    /_fake/emails   every email received, newest last
//   DELETE /_fake/emails   forget them
import express from "express";

const PORT = Number(process.env.FAKE_RESEND_PORT ?? 4030);
let emails: { from: string; to: string[]; subject: string; text: string }[] = [];

const app = express();
app.use(express.json());

// Accepts one email the way Resend does, checking only that a key was sent.
app.post("/emails", (req, res) => {
  if (!req.get("authorization")?.startsWith("Bearer ")) return res.status(401).json({ message: "Missing API key" });
  const { from, to, subject, text } = req.body ?? {};
  if (!from || !Array.isArray(to) || !subject) return res.status(422).json({ message: "from, to and subject are required" });
  emails.push({ from, to, subject, text });
  res.json({ id: `fake_${emails.length}` });
});

// Lists or clears the received emails.
app.get("/_fake/emails", (_req, res) => res.json(emails));
app.delete("/_fake/emails", (_req, res) => {
  emails = [];
  res.json({ cleared: true });
});

app.listen(PORT, () => console.log(`Fake Resend on :${PORT}`));
