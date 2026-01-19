const express = require("express");
const { chromium } = require("playwright-chromium");

const app = express();
app.use(express.json());

// ---------- Captcha helper ----------
function numberToFrench(n) {
  const map = {
    0:"zero",1:"un",2:"deux",3:"trois",4:"quatre",5:"cinq",6:"six",7:"sept",8:"huit",9:"neuf",
    10:"dix",11:"onze",12:"douze",13:"treize",14:"quatorze",15:"quinze",16:"seize",
    17:"dix-sept",18:"dix-huit",19:"dix-neuf",20:"vingt"
  };
  return map[n] ?? null;
}

function solveFrenchWordMath(labelText) {
  if (!labelText) return null;
  const q = labelText.toLowerCase().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const wordToNumber = {
    "zero":0,"un":1,"deux":2,"trois":3,"quatre":4,"cinq":5,"six":6,"sept":7,"huit":8,"neuf":9,
    "dix":10,"onze":11,"douze":12,"treize":13,"quatorze":14,"quinze":15,"seize":16,
  };

  const m = q.match(/\b(zero|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize)\b\s*([+\-])\s*\b(zero|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize)\b/);
  if (!m) return null;

  const a = wordToNumber[m[1]];
  const op = m[2];
  const b = wordToNumber[m[3]];
  const res = op === "+" ? (a + b) : (a - b);

  return numberToFrench(res);
}

// ---------- Main automation ----------
async function runRegister({ username, email, password }) {
  const REGISTER_URL = "https://www.forumpimpf.net/ucp.php?mode=register";

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();

  try {
    await page.goto(REGISTER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait form fields (avoid random timeouts)
    await page.waitForSelector('input[name="username"]', { timeout: 30000 });

    await page.fill('input[name="username"]', username);
    await page.fill('input[name="new_password"]', password);
    await page.fill('input[name="password_confirm"]', password);
    await page.fill('input[name="email"]', email);

    // Captcha question label
    const labelSel = ".captcha-panel dl dt label";
    await page.waitForSelector(labelSel, { timeout: 30000 });
    const question = await page.$eval(labelSel, el => (el.innerText || "").trim());

    const answer = solveFrenchWordMath(question);
    if (!answer) {
      return { ok: false, error: "captcha_unparsed", question };
    }

    await page.fill('input[name="qa_answer"]', answer);

    // Submit
    await page.click("#submit");
    try {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {}

    const finalUrl = page.url();
    const bodySnippet = await page.evaluate(() => (document.body.innerText || "").slice(0, 900));

    return { ok: true, finalUrl, captcha: { question, answer }, snippet: bodySnippet };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ---------- HTTP endpoint ----------
app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "missing_fields",
        required: ["username", "email", "password"],
      });
    }

    const result = await runRegister({ username, email, password });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error", message: String(e?.message || e) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Listening on", port));
