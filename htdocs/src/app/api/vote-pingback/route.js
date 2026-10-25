import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import fs from "fs";
import path from "path";

const ERROR_LOG_FILE = path.resolve(process.cwd(), "vote_pingback_errors.txt");
const PINGBACK_KEY = process.env.GTOP_PINGBACK_KEY;

function logPingbackError({ error, pingUsername, voterIP, reason }) {
  const logLine = `[${new Date().toISOString()}] ERROR: ${error} | user: ${pingUsername} | ip: ${voterIP} | reason: ${reason}\n`;
  try {
    fs.appendFileSync(ERROR_LOG_FILE, logLine);
  } catch (e) {}
}

function logPingbackAccess({ method, headers, body }) {
  const logLine = `[${new Date().toISOString()}] ACCESS: method=${method} | headers=${JSON.stringify(headers)} | body=${body}\n`;
  try {
    fs.appendFileSync(ERROR_LOG_FILE, logLine);
  } catch (e) {}
}

async function processEntry({ voterIP, success, reason, pingUsername, pingbackkey, site }) {
  const db = await connectToDatabase();

  // Always log the vote attempt in vote_logs for security/audit
  await db.query`
    INSERT INTO [WEBSITE_DBF].[dbo].[vote_logs] (account, site, vote_time, ip_address, success, reason) VALUES (${pingUsername}, ${site}, GETDATE(), ${voterIP}, ${success}, ${reason})
  `;

  if (PINGBACK_KEY && pingbackkey !== PINGBACK_KEY) {
    logPingbackError({ error: "Invalid pingback key", pingUsername, voterIP, reason });
    return { status: 403, message: "Invalid pingback key." };
  }

  if (!pingUsername) {
    logPingbackError({ error: "Missing username", pingUsername, voterIP, reason });
    return { status: 400, message: "Missing username." };
  }

  // Check if user exists
  const userResult = await db.query`
    SELECT account FROM ACCOUNT_DBF.dbo.ACCOUNT_TBL WHERE account = ${pingUsername}
  `;
  if (!userResult.recordset[0]) {
    logPingbackError({ error: "User not found", pingUsername, voterIP, reason });
    return { status: 404, message: "User not found." };
  }

  if (Number(success) === 0) {
    // Reward the user
    await db.query`
      UPDATE ACCOUNT_DBF.dbo.ACCOUNT_TBL SET votepoint = votepoint + 10 WHERE account = ${pingUsername}
    `;
  }

  return { status: 200, message: "Processed." };
}

export async function POST(req) {
  // Log all access attempts
  let body = "";
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      body = JSON.stringify(await req.clone().json());
    } else {
      body = "[form data]";
    }
  } catch (e) {
    body = "[unreadable]";
  }
  logPingbackAccess({
    method: "POST",
    headers: Object.fromEntries(req.headers.entries()),
    body,
  });

  let responses = [];

  if (contentType.includes("application/json")) {
    const data = await req.json();
    if (!data || !data.Common) {
      return new Response("Invalid JSON data.", { status: 400 });
    }
    const pingbackkey = data.pingbackkey;
    const site = data.siteid ? String(data.siteid) : "gtop100";
    for (const entry of data.Common) {
      let mapped = {};
      for (const sub of entry) mapped = { ...mapped, ...sub };
      // Accept pb_name, pingUsername, custom, account, user
      const pingUsername = mapped.pingUsername || mapped.pb_name || mapped.custom || mapped.account || mapped.user;
      const { ip: voterIP, success, reason } = mapped;
      const result = await processEntry({ voterIP, success: Math.abs(Number(success)), reason, pingUsername, pingbackkey, site });
      responses.push(result);
    }
    return new Response("JSON data processed successfully.", { status: 200 });
  } else {
    // Handle form POST
    const form = await req.formData();
    // Accept pingUsername, custom, account, user
    const pingUsername = form.get("pingUsername") || form.get("custom") || form.get("account") || form.get("user");
    const voterIP = form.get("VoterIP");
    const success = Math.abs(Number(form.get("Successful") || 1));
    const reason = form.get("Reason");
    const pingbackkey = form.get("pingbackkey");
    const site = form.get("site") || "gtop100";
    const result = await processEntry({ voterIP, success, reason, pingUsername, pingbackkey, site });
    return new Response("POST data processed successfully.", { status: result.status });
  }
}

export async function GET(req) {
  // Log all access attempts
  logPingbackAccess({
    method: "GET",
    headers: Object.fromEntries(req.headers.entries()),
    body: req.url,
  });
  // Optionally, keep your old GET handler for manual/curl testing
  return NextResponse.json({ success: false, error: "Use POST or JSON for pingbacks." }, { status: 405 });
} 