// Run:  npm run test-mail
// Sends one test e-mail and tells you exactly what is wrong if it fails.
require("./envloader");
const { sendMail, mailConfigured } = require("./mailer");

(async () => {
  if (!mailConfigured()) {
    console.log("\nNOT CONFIGURED: open the file named .env (copy .env.example to .env first)");
    console.log("and fill in SMTP_USER and SMTP_PASS.\n");
    process.exit(1);
  }
  console.log("Sending a test e-mail from " + process.env.SMTP_USER + " ...");
  try {
    await sendMail({ subject: "Builders test e-mail", text: "If you can read this, e-mail sending works." });
    console.log("\nOK! Test e-mail sent. Check the inbox (and the Junk folder) of " +
      (process.env.REPORT_TO || "you@example.com") + "\n");
  } catch (e) {
    console.log("\nFAILED: " + e.message + "\n");
    if (e.code === "EAUTH" || /535|auth/i.test(e.message)) {
      console.log("-> Wrong login. Hotmail/Outlook does NOT accept your normal password here.");
      console.log("   Turn on two-step verification, then create an APP PASSWORD at");
      console.log("   https://account.live.com/proofs/manage/additional  and put it in SMTP_PASS");
      console.log("   (without spaces).");
      console.log("   If it still fails, use a Gmail account instead (see .env.example).\n");
    } else if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ENOTFOUND", "ECONNREFUSED"].includes(e.code)) {
      console.log("-> Can't reach the mail server. Check your internet / firewall / antivirus,");
      console.log("   and that SMTP_HOST and SMTP_PORT are right.\n");
    }
    process.exit(1);
  }
})();
