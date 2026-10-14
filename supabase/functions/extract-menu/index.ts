// メニュー資料（文字・画像）をClaudeで読み取り、商品データ(JSON)にして返す
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RULES = `あなたは飲食店のメニュー表を正確にデータ化する担当者です。資料から、お客様に提供される全メニュー商品を漏れなく抜き出してください。
ルール:
- 1商品につき1件。サイズ・量・人数で価格が違う場合は別の商品に分け、名前の末尾に（中）（大）（2人前）などを付ける
- price は税込価格を整数（円）で。税込と税抜が併記されていれば税込。記載がない・読めない場合は null
- category は資料上の見出し（例：前菜、揚げ物、ドリンク）。見出しがなければ ""
- description は商品に付いた説明文・内容量・注記（期間限定、数量限定、アレルギー表示など）。なければ ""
- 店名、住所、営業時間、サービス料の案内など、商品でないものは含めない
- 推測で補ったり言い換えたりしない。表記どおりに写す
- 資料が「変更依頼」の文面なら、記載された商品だけを抜き出す
- 資料がWebページの場合、ページ内のメニュー部分だけを対象にし、口コミ・広告・他店の情報・ナビゲーションは無視する
返答は次の形のJSONのみ。1商品を [カテゴリ, 商品名, 税込価格(整数またはnull), 説明] の配列にし、説明がなければ "" にする:
{"items":[["前菜","枝豆",380,""],["ドリンク","生ビール（中）",580,"期間限定"]]}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// [カテゴリ, 商品名, 価格, 説明] の配列、または {category,name,price,description} を商品データにそろえる
function toItem(v: unknown): Record<string, unknown> | null {
  if (Array.isArray(v)) { const [category, name, price, description] = v; return name ? { category: category ?? "", name, price: price ?? null, description: description ?? "" } : null; }
  if (v && typeof v === "object" && (v as Record<string, unknown>).name) return v as Record<string, unknown>;
  return null;
}
// 途中で切れた返答から、最後まで書けている商品だけを取り出す
function salvageItems(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /\[\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*,\s*(-?\d+(?:\.\d+)?|null)\s*,\s*("(?:[^"\\]|\\.)*")\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { try { const it = toItem([JSON.parse(m[1]), JSON.parse(m[2]), JSON.parse(m[3]), JSON.parse(m[4])]); if (it) out.push(it); } catch { /* skip */ } }
  return out;
}

function parseItems(text: string): { items: unknown[] } | null {
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(text.trim());
  if (!v) { const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) v = tryParse(m[1]); }
  if (!v) { const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a >= 0 && b > a) v = tryParse(text.slice(a, b + 1)); }
  const list = Array.isArray(v) ? v : v && Array.isArray(v.items) ? v.items : null;
  if (list) return { items: list.map(toItem).filter(Boolean) as unknown[] };
  const salvaged = salvageItems(text);
  return salvaged.length ? { items: salvaged } : null;
}

/* ---- グルメサイト等のページ取得 ---- */
// 社内ネットワークやクラウド内部のアドレスへの取得を防ぐ
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return true;
  }
  if (h.includes(":")) return true; // IPv6 リテラルは許可しない
  return false;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", yen: "¥", copy: "©" } as Record<string, string>)[k] ?? m;
  });
}

function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  let t = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|dt|dd|table|ul|ol|header|footer)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ");
  t = decodeEntities(t).replace(/[ \t\u3000]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: t };
}

async function fetchPage(raw: string): Promise<{ title: string; text: string; url: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw { code: "bad_url", message: "URLの形式が正しくありません。" }; }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol) || (url.port && !["80", "443"].includes(url.port)) || isBlockedHost(url.hostname)) {
      throw { code: "bad_url", message: "このURLは読み込めません。" };
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MenuDiffChecker/1.0)", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "ja,en;q=0.5" },
      });
    } catch { throw { code: "fetch_failed", message: "ページを取得できませんでした。時間をおいて試すか、ページの文字をコピーして貼り付けてください。" }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, url); continue; }
    if (!res.ok) throw { code: "fetch_failed", message: `ページを取得できませんでした（サイトの応答 ${res.status}）。サイト側で自動取得が制限されている可能性があります。ページの文字をコピーして貼り付けるか、スクリーンショットを読み込んでください。` };
    const ctype = res.headers.get("content-type") || "";
    if (!/html|text\/plain/i.test(ctype)) throw { code: "fetch_failed", message: "このURLはWebページではないため読み込めません。" };
    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, 4_000_000);
    let cs = (ctype.match(/charset=([\w-]+)/i)?.[1] || "").toLowerCase();
    if (!cs) { const head = new TextDecoder("latin1").decode(buf.slice(0, 4000)); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || "utf-8").toLowerCase(); }
    let html: string;
    try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder("utf-8").decode(buf); }
    const page = htmlToText(html);
    if (page.text.replace(/\s/g, "").length < 50) throw { code: "fetch_failed", message: "ページから文字を取り出せませんでした。メニューが画像の場合は、スクリーンショットを読み込んでください。" };
    return { ...page, url: url.toString() };
  }
  throw { code: "fetch_failed", message: "転送が多すぎるため、ページを取得できませんでした。" };
}

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] as string || ""; } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405);

  // ログイン中の社員か確認
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey());
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  const email = (u?.user?.email || "").toLowerCase();
  const domain = (Deno.env.get("ALLOWED_EMAIL_DOMAIN") || "8sin.co.jp").toLowerCase();
  if (!u?.user || !email.endsWith("@" + domain)) {
    return json({ code: "forbidden", message: "社内のメールアドレスでログインしてください。" }, 403);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ code: "no_api_key", message: "読み取り用のClaude APIキーがまだ設定されていません。管理者に設定を依頼してください。" }, 503);

  let body: { text?: string; url?: string; images?: { media_type: string; data: string }[]; labels?: string };
  try { body = await req.json(); } catch { return json({ code: "bad_request", message: "送信内容を読み取れませんでした。" }, 400); }
  let text = String(body.text || "").slice(0, 200000);
  let pageTitle = "";
  if (body.url) {
    try {
      const page = await fetchPage(String(body.url));
      pageTitle = page.title;
      text = `### 資料：Webページ「${page.title}」（${page.url}）\n${page.text.slice(0, 150000)}`;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return json({ code: err.code || "fetch_failed", message: err.message || "ページを取得できませんでした。" }, 422);
    }
  }
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 8)
    .filter((im) => im && typeof im.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(im.media_type));
  if (!text.trim() && !images.length) return json({ code: "bad_request", message: "読み取る資料がありません。" }, 400);

  const content: unknown[] = images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }));
  content.push({
    type: "text",
    text: RULES +
      (images.length ? `\n\n添付画像はメニュー表（${String(body.labels || "").slice(0, 500)}）です。画像内の文字を読み取ってください。` : "") +
      (text ? `\n\n=== 資料ここから ===\n${text}` : ""),
  });

  const model = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5-5";
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 32000, messages: [{ role: "user", content }] }),
    });
  } catch {
    return json({ code: "upstream_error", message: "Claudeに接続できませんでした。少し待ってからもう一度お試しください。" }, 502);
  }
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    const s = res.status;
    const code = s === 401 || s === 403 ? "bad_api_key" : s === 429 || s === 529 ? "rate_limited" : s === 413 ? "too_large" : "upstream_error";
    const message = code === "bad_api_key" ? "Claude APIキーが正しくないか、無効になっています。管理者に確認してください。"
      : code === "rate_limited" ? "Claudeが混み合っています。少し待ってからもう一度お試しください。"
      : code === "too_large" ? "資料が大きすぎます。ページ数を減らしてください。"
      : "読み取りに失敗しました。もう一度お試しください。";
    console.error("anthropic error", s, out?.error?.message);
    return json({ code, message }, 502);
  }

  const txt = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const parsed = parseItems(txt);

  // 利用記録（費用把握用）
  try {
    await admin.from("extract_logs").insert({
      user_email: email, input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, images: images.length,
    });
  } catch (_) { /* 記録に失敗しても読み取り結果は返す */ }

  if (!parsed) return json({ code: "invalid_json", message: "読み取り結果をうまく整理できませんでした。もう一度お試しください。" }, 502);
  return json({ items: parsed.items, truncated: out.stop_reason === "max_tokens", page_title: pageTitle || undefined });
});
