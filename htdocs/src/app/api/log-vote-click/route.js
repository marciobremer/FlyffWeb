import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";

// In-memory rate limit store (for demonstration; use Redis or DB for production)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX = 3;

export async function POST(req) {
  const { account, site } = await req.json();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "";
  const db = await connectToDatabase();

  // Rate limiting: max 3 requests per 5 minutes per IP
  const now = Date.now();
  const rlKey = `${ip}:${site}`;
  let rl = rateLimitStore.get(rlKey) || [];
  rl = rl.filter(ts => now - ts < RATE_LIMIT_WINDOW);
  if (rl.length >= RATE_LIMIT_MAX) {
    return NextResponse.json({ success: false, error: "Muitas tentativas. Aguarde um pouco e tente de novo." }, { status: 429 });
  }
  rl.push(now);
  rateLimitStore.set(rlKey, rl);

  // 0. Check if the account exists in the database
  const accountExists = await db.query`
    SELECT TOP 1 account FROM ACCOUNT_DBF.dbo.ACCOUNT_TBL WHERE account = ${account}
  `;
  if (!accountExists.recordset[0]) {
    // Log attempt for non-existent account
    await db.query`
      INSERT INTO [WEBSITE_DBF].[dbo].[vote_logs] (account, site, vote_time, ip_address, success, reason)
      VALUES (${account}, ${site}, GETDATE(), ${ip}, 3, 'Blocked: Account does not exist in database')
    `;
    return NextResponse.json({
      success: false,
      error: "Conta não encontrada. Confira o nome da conta."
    }, { status: 200 });
  }

  // 1. Check if this account has already voted in the last 12 hours (any IP)
  const accountRecent = await db.query`
    SELECT TOP 1 vote_time FROM [WEBSITE_DBF].[dbo].[vote_logs]
    WHERE account = ${account} AND site = ${site} AND (success = 0 OR success = 1)
    AND DATEDIFF(HOUR, vote_time, GETDATE()) < 12
    ORDER BY vote_time DESC
  `;
  if (accountRecent.recordset[0]) {
    const lastVoteTime = new Date(accountRecent.recordset[0].vote_time);
    const diffMs = now - lastVoteTime;
    const diffSec = Math.floor((12 * 60 * 60 * 1000 - diffMs) / 1000);
    // Log attempt
    await db.query`
      INSERT INTO [WEBSITE_DBF].[dbo].[vote_logs] (account, site, vote_time, ip_address, success, reason)
      VALUES (${account}, ${site}, GETDATE(), ${ip}, 3, 'Blocked: Account voted in last 12h')
    `;
    return NextResponse.json({
      success: false,
      error: "Esta conta já votou nas últimas 12 horas.",
      wait_seconds: diffSec > 0 ? diffSec : 0
    }, { status: 200 });
  }

  // 2. Check if this IP has already voted with a different account in the last 12 hours
  const ipRecent = await db.query`
    SELECT TOP 1 account, vote_time FROM [WEBSITE_DBF].[dbo].[vote_logs]
    WHERE ip_address = ${ip} AND site = ${site} AND (success = 0 OR success = 1)
    AND DATEDIFF(HOUR, vote_time, GETDATE()) < 12 AND account != ${account}
    ORDER BY vote_time DESC
  `;
  if (ipRecent.recordset[0]) {
    const lastVoteTime = new Date(ipRecent.recordset[0].vote_time);
    const diffMs = now - lastVoteTime;
    const diffSec = Math.floor((12 * 60 * 60 * 1000 - diffMs) / 1000);
    // Log attempt
    await db.query`
      INSERT INTO [WEBSITE_DBF].[dbo].[vote_logs] (account, site, vote_time, ip_address, success, reason)
      VALUES (${account}, ${site}, GETDATE(), ${ip}, 3, 'Blocked: IP voted with different account in last 12h')
    `;
    return NextResponse.json({
      success: false,
      error: `Só uma conta por IP pode votar a cada 12 horas. A conta '${ipRecent.recordset[0].account}' já votou deste IP.`,
      wait_seconds: diffSec > 0 ? diffSec : 0
    }, { status: 200 });
  }

  // Log the click (status: 'clicked', not yet rewarded)
  await db.query`
    INSERT INTO [WEBSITE_DBF].[dbo].[vote_logs] (account, site, vote_time, ip_address, success, reason)
    VALUES (${account}, ${site}, GETDATE(), ${ip}, 2, 'Vote button clicked and rewarded')
  `;

  // Reward the user (add points immediately on click, if you want to do this)
  await db.query`
    UPDATE ACCOUNT_DBF.dbo.ACCOUNT_TBL SET votepoint = votepoint + 10 WHERE account = ${account}
  `;

  return NextResponse.json({ success: true, message: "Voto registrado e recompensa entregue." });
}

export async function GET() {
  return NextResponse.json({ success: false, error: "Method Not Allowed" }, { status: 405 });
} 