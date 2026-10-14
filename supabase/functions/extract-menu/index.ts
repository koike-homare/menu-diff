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
- price_text は資料の表記どおりの価格文字列
- category は資料上の見出し（例：前菜、揚げ物、ドリンク）。見出しがなければ ""
- description は商品に付いた説明文・内容量・注記（期間限定、数量限定、アレルギー表示など）。なければ ""
- 店名、住所、営業時間、サービス料の案内など、商品でないものは含めない
- 推測で補ったり言い換えたりしない。表記どおりに写す
- 資料が「変更依頼」の文面なら、記載された商品だけを抜き出す
返答はJSONのみ: {"items":[{"category":"前菜","name":"枝豆","price":380,"price_text":"380円","description":""}]}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function parseItems(text: string): { items: unknown[] } | null {
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(text.trim());
  if (!v) { const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) v = tryParse(m[1]); }
  if (!v) { const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a >= 0 && b > a) v = tryParse(text.slice(a, b + 1)); }
  if (Array.isArray(v)) return { items: v };
  if (v && Array.isArray(v.items)) return v;
  return null;
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

  let body: { text?: string; images?: { media_type: string; data: string }[]; labels?: string };
  try { body = await req.json(); } catch { return json({ code: "bad_request", message: "送信内容を読み取れませんでした。" }, 400); }
  const text = String(body.text || "").slice(0, 200000);
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
      body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: "user", content }] }),
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
  return json({ items: parsed.items, truncated: out.stop_reason === "max_tokens" });
});
