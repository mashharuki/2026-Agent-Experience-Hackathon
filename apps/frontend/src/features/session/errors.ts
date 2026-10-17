import { ApiError } from "../../api/custom-fetch";

const MESSAGES: Record<string, string> = {
  session_ended: "この相談は終了しています。もう一度はじめてください。",
  change_limit_reached:
    "試せるのは2回までです。ここまでの写真を比べて選べます。",
  analysis_limit_reached: "この相談で解析できる回数に達しました。",
  too_many_requests: "しばらくしてからもう一度お試しください。",
  quota_exceeded: "本日の利用枠に達しました。",
  service_unavailable: "いまは受け付けていません。時間をおいてお試しください。",
  not_accepting: "いまは受け付けていません。時間をおいてお試しください。",
  unauthenticated: "ログインの有効期限が切れました。ログインし直してください。",
};

/** A short, kind message for the user. Never includes anything the server echoed. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return (
      MESSAGES[error.code] ?? "うまくいきませんでした。もう一度お試しください。"
    );
  }
  return "うまくいきませんでした。通信の状態を確かめて、もう一度お試しください。";
}
