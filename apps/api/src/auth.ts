import { createHmac } from "crypto";

export interface TelegramInitData {
  query_id?: string;
  user?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  receiver?: object;
  chat_instance?: string;
  chat_type?: string;
  start_param?: string;
  added_to_attachment_menu?: boolean;
  auth_date: number;
  hash: string;
}

export function validateTelegramInitData(
  initData: string,
  botToken: string
): TelegramInitData | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (computedHash !== hash) return null;

    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return null;

    const userStr = params.get("user");
    const user = userStr ? JSON.parse(userStr) : undefined;

    return {
      query_id: params.get("query_id") || undefined,
      user: user
        ? {
            id: user.id,
            is_bot: user.is_bot,
            first_name: user.first_name,
            last_name: user.last_name,
            username: user.username,
            language_code: user.language_code,
          }
        : undefined,
      receiver: undefined,
      chat_instance: params.get("chat_instance") || undefined,
      chat_type: params.get("chat_type") || undefined,
      start_param: params.get("start_param") || undefined,
      added_to_attachment_menu: params.get("added_to_attachment_menu") === "true",
      auth_date: authDate,
      hash,
    };
  } catch {
    return null;
  }
}

export function getUserIdFromInitData(initData: string, botToken: string): string | null {
  const validated = validateTelegramInitData(initData, botToken);
  return validated?.user?.id?.toString() || null;
}