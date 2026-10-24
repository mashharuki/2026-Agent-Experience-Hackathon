import { Button, Slider } from "@mui/material";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { degrees, FLEET, fleetWinners, STEP } from "sailing-sim";
import type { FleetRuntime } from "./fleet-runtime";
import { clearHistory, readHistory, saveResult } from "./prediction-history";
import { RaceAudio } from "./race-audio";
import { eventLabel, highlights, spotlight } from "./race-events";

export type Language = "ja" | "en";
const copy = {
  ja: {
    tactics: "戦術表示",
    director: "自動中継",
    motion: "カメラ・艇の揺れ",
    audio: "海の音",
    help: "観戦ガイド",
    events: "レースの見どころ",
    empty: "ブローと艇の動きに注目",
    observed: "実際の動きからの通知",
    replay: "3Dリプレイ",
    play: "再生",
    pause: "停止",
    exit: "ライブ結果へ戻る",
    history: "この端末の予想記録",
    clear: "記録を消去",
    attempts: "戦",
    hits: "的中",
    preview: "ルール",
    decider: "実AI",
    start: "風上マークを回って、スタート側へ戻るコース。",
    same: "艇の性能は同じ。紹介は戦術方針で、強さや勝率ではありません。",
    guide:
      "タック：風上へ進むために風をまたいで向きを変える動作。ブロー：周囲より強い風の領域。風向計は風が来る向き。色の線は航跡、距離差は残距離の近似です。",
    summary: "転機を振り返る",
    noHighlight: "まだ記録された転機はありません。",
    replayNote: "記録の再生・追加のAI判断なし",
    soundError: "このブラウザーでは音を有効にできませんでした。",
    upwind: "風上マークへ",
    downwind: "フィニッシュへ",
    finished: "完走",
    ready: "配置確認",
    diagnostics: "表示情報",
    countdown: "出走まで",
    cancel: "取消",
    streak: "連続的中",
    storage: "直近100戦・実AIとルールを別集計。未成立は含みません。",
    reveal: "タックやブローが順位にどうつながるか見届けよう。",
  },
  en: {
    tactics: "Tactical overlay",
    director: "Auto broadcast",
    motion: "Camera / boat motion",
    audio: "Sea audio",
    help: "Watching guide",
    events: "Race spotlight",
    empty: "Watch the pressure and the boats",
    observed: "Observed race events",
    replay: "3D replay",
    play: "Play",
    pause: "Pause",
    exit: "Return to live result",
    history: "Predictions on this device",
    clear: "Clear history",
    attempts: "races",
    hits: "hits",
    preview: "Rules",
    decider: "Real AI",
    start: "Round the windward mark, then return to the start side.",
    same: "Equal boat performance. Profiles describe tactics, not measured strength or odds.",
    guide:
      "Tack: turn through the wind to sail upwind. Pressure: an area of stronger wind. The compass points toward the wind source. Lines are tracks; gaps approximate distance remaining.",
    summary: "Review the turning points",
    noHighlight: "No turning points recorded yet.",
    replayNote: "Recorded playback · no additional AI calls",
    soundError: "Audio could not be enabled in this browser.",
    upwind: "To windward mark",
    downwind: "To finish",
    finished: "Finished",
    ready: "Starting layout",
    diagnostics: "Display details",
    countdown: "Starting in",
    cancel: "Cancel",
    streak: "hit streak",
    storage:
      "Last 100 races. Real AI and rules counted separately. Unscored races excluded.",
    reveal: "Watch how maneuvers and pressure turn into position changes.",
  },
};
export const experienceText = (language: Language) => copy[language];
const time = (tick: number) =>
  `${Math.floor((tick * STEP) / 60)}:${Math.floor((tick * STEP) % 60)
    .toString()
    .padStart(2, "0")}`;

export function Briefing({
  runtime,
  language,
}: {
  runtime: FleetRuntime;
  language: Language;
}) {
  const s = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot),
    t = copy[language];
  if (s.race.status !== "ready") return null;
  return (
    <div className="race-briefing">
      <b>
        {(s.wind.speed * 1.94384).toFixed(1)} kn ·{" "}
        {Math.round(degrees(s.wind.direction))}°
      </b>
      <p>{t.start}</p>
      <small>{t.same}</small>
    </div>
  );
}

export function ViewingControls({
  runtime,
  language,
}: {
  runtime: FleetRuntime;
  language: Language;
}) {
  const s = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot),
    t = copy[language];
  const audio = useRef<RaceAudio | null>(null);
  const [sound, setSound] = useState(false),
    [error, setError] = useState(false);
  const previousStatus = useRef(s.race.status);
  useEffect(
    () => () => {
      audio.current?.dispose();
      audio.current = null;
    },
    [],
  );
  useEffect(() => {
    const hidden = () => audio.current?.mute();
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  useEffect(() => {
    if (sound && !document.hidden) {
      audio.current?.update(
        s.sceneRace.boats[s.focusIndex].speed,
        s.wind.speed,
        s.race.status === "running" || s.replayPlaying,
      );
      if (previousStatus.current === "ready" && s.race.status === "running")
        audio.current?.horn();
    } else audio.current?.mute();
    previousStatus.current = s.race.status;
  }, [sound, s]);
  return (
    <details className="viewing-settings">
      <summary>
        {language === "ja" ? "観戦の表示・音" : "Viewing & audio"}
      </summary>
      {(["tactics", "autoCamera", "cameraMotion"] as const).map((key, i) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={s[key]}
            onChange={(e) => runtime.setPresentation(key, e.target.checked)}
          />
          {[t.tactics, t.director, t.motion][i]}
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={sound}
          onChange={async (e) => {
            const enabled = e.target.checked;
            if (!enabled) {
              setSound(false);
              audio.current?.mute();
              return;
            }
            try {
              audio.current ??= new RaceAudio();
              await audio.current.enable();
              setSound(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        />
        {t.audio}
      </label>
      {error && <p role="status">{t.soundError}</p>}
      <details>
        <summary>{t.help}</summary>
        <p>{t.guide}</p>
      </details>
      <small>
        {t.diagnostics}: sea-v3 ·{" "}
        {import.meta.env.DEV ? "development" : "production"}
      </small>
    </details>
  );
}

export function Spotlight({
  runtime,
  language,
}: {
  runtime: FleetRuntime;
  language: Language;
}) {
  const s = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot),
    t = copy[language];
  const e = spotlight(s.events, s.sceneRace.tick);
  const boat = s.sceneRace.boats[s.focusIndex];
  return (
    <div className="race-spotlight" aria-live="polite" aria-atomic="true">
      <span>
        {s.replayTick !== null ? t.replay : t.events} ·{" "}
        {s.race.status === "ready" ? t.ready : t[boat.leg]}
      </span>
      <strong>
        {e
          ? `${FLEET.find((b) => b.id === e.boatId)?.name} · ${eventLabel(e.kind, language)}`
          : t.empty}
      </strong>
      <small>{e ? `${time(e.tick)} · ${t.observed}` : t.reveal}</small>
    </div>
  );
}

export function ReplayControls({
  runtime,
  language,
  onResult,
}: {
  runtime: FleetRuntime;
  language: Language;
  onResult: () => void;
}) {
  const s = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot),
    t = copy[language];
  if (s.replayTick === null) return null;
  return (
    <div className="replay-console">
      <strong>
        {t.replay} · {time(s.replayTick)}
      </strong>
      <small>{t.replayNote}</small>
      <Slider
        aria-label={t.replay}
        min={0}
        max={Math.max(1, s.race.tick)}
        value={s.replayTick}
        onChange={(_, value) => runtime.setReplay(value as number)}
      />
      <div>
        {[0.5, 1, 2].map((speed) => (
          <Button
            key={speed}
            aria-pressed={s.replayPlaying && s.replaySpeed === speed}
            onClick={() => runtime.playReplay(speed)}
          >
            {speed}×
          </Button>
        ))}
        <Button onClick={() => runtime.setReplay(s.replayTick)}>
          {t.pause}
        </Button>
        <Button
          onClick={() => {
            runtime.setReplay(null);
            onResult();
          }}
        >
          {t.exit}
        </Button>
      </div>
    </div>
  );
}

export function TurningPoints({
  runtime,
  language,
  onReplay,
}: {
  runtime: FleetRuntime;
  language: Language;
  onReplay: (tick: number) => void;
}) {
  const t = copy[language],
    points = highlights(runtime.events.events);
  return (
    <section className="turning-points">
      <h3>{t.summary}</h3>
      {points.length ? (
        points.map((e) => (
          <Button key={e.id} onClick={() => onReplay(Math.max(0, e.tick - 90))}>
            {time(e.tick)} · {FLEET.find((b) => b.id === e.boatId)?.name} ·{" "}
            {eventLabel(e.kind, language)} ↗
          </Button>
        ))
      ) : (
        <p>{t.noHighlight}</p>
      )}
      <Button variant="outlined" onClick={() => onReplay(0)}>
        {t.replay}
      </Button>
    </section>
  );
}

export function PredictionHistory({
  runtime,
  language,
}: {
  runtime: FleetRuntime;
  language: Language;
}) {
  const s = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot),
    t = copy[language];
  const [history, setHistory] = useState(readHistory);
  useEffect(() => {
    if (!["finished", "timed_out"].includes(s.race.status) || !s.prediction)
      return;
    const winners = fleetWinners(s.race);
    if (!winners.length) return;
    setHistory(
      saveResult({
        id: runtime.currentRaceId,
        mode: s.mode,
        scenario: s.race.scenario,
        hit: winners.includes(s.prediction),
      }),
    );
  }, [runtime, s.race.status, s.mode, s.prediction, s.race]);
  const races = history.filter(
    (r) => r.mode === s.mode && r.scenario === s.race.scenario,
  );
  let streak = 0;
  for (const r of [...races].reverse()) {
    if (!r.hit) break;
    streak++;
  }
  return (
    <details className="prediction-history">
      <summary>{t.history}</summary>
      <p>
        {t[s.mode]} · {s.race.scenario}: {races.length} {t.attempts} /{" "}
        {races.filter((r) => r.hit).length} {t.hits} · {streak} {t.streak}
      </p>
      <small>{t.storage}</small>
      <Button
        onClick={() => {
          clearHistory();
          setHistory([]);
        }}
      >
        {t.clear}
      </Button>
    </details>
  );
}
