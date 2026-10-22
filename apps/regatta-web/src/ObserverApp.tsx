import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Slider,
} from "@mui/material";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  degrees,
  FLEET,
  type FleetRace,
  fleetRanking,
  fleetWinners,
  MARK,
  MAX_TICKS,
  type Scenario,
  STEP,
  visiblePressure,
} from "sailing-sim";
import {
  type CloudConfig,
  cloudHealth,
  cloudTransport,
  completeSignIn,
  type Debrief,
  debriefRequest,
  loadCloudConfig,
  requestDebrief,
  type Session,
  startSignIn,
} from "./cloud";
import { FleetRuntime, replayFleet } from "./fleet-runtime";
import { mountScene } from "./scene";

const ja = {
  title: "風を読んで、勝者を選べ。",
  sub: "4艇の戦術を、海の上で見届ける。",
  prediction: "勝つと思う艇を選ぶ",
  picked: "あなたの予想",
  start: "この艇を予想して出走",
  choose: "艇を選んでください",
  pause: "一時停止",
  resume: "観戦を再開",
  end: "レースを終了",
  again: "次のレースを予想",
  scenario: "海面の条件",
  dynamic: "変化する海面",
  steady: "一定風",
  shift: "風の振れ",
  pressure: "ブロー",
  mode: "判断エンジン",
  preview: "ルールのプレビュー",
  decider: "Strands Decider 実モデル",
  previewNote: "プレビューは固定ルールです。実モデルの判断ではありません。",
  modelNote: "ローカルの実Deciderが各艇の戦術を選びます。",
  connect: "モデル接続を確認",
  offline: "実モデル未接続",
  ready: "モデル準備完了",
  loading: "モデル準備中",
  rank: "暫定順位・追従艇",
  rankNote: "残距離の近似。順位はフィニッシュで確定します。",
  decisions: "最新の戦術判断",
  noDecisions: "出走すると、各艇が選んだ戦術がここに届きます。",
  pending: "が判断中",
  following: "追従中",
  follow: "追従",
  helm: "艇上",
  overview: "俯瞰",
  quality: "描画品質",
  high: "高画質",
  low: "軽量",
  speed: "艇速",
  left: "残り",
  wind: "真風",
  heading: "針路",
  tacks: "タック",
  chart: "コース図",
  result: "レースの結果",
  hit: "予想的中！",
  miss: "次は、どの艇を選ぶ？",
  noWinner: "レース不成立・予想判定なし",
  winner: "勝者",
  replay: "航跡を振り返る",
  export: "記録を保存",
  close: "閉じる",
  practice: "予想・観戦",
  aborted: "レース終了",
  running: "レース中",
  paused: "一時停止中",
  finished: "全艇フィニッシュ",
  timed_out: "制限時間",
  readyRace: "スタート前",
  applied: "適用",
  expired: "期限切れ",
  rejected: "不採用",
  failed: "失敗",
  fallback: "継続・推論失敗",
  rule: "ルール",
  real: "Decider",
  safety:
    "簡易の接触・境界ルール。同じ艇性能、戦術方針と開始位置が異なります。",
  footer: "ゲーム用の近似モデル。勝率や実艇性能を保証するものではありません。",
  controls: "艇を選んで追従。Space：一時停止／再開",
  modelError:
    "推論の失敗・期限超過を検出しました。継続して失敗したレースは不成立として停止します。",
  finishedBoat: "完走",
  dns: "未完走",
  waiting: "待機中",
  hold_course: "針路を維持",
  tack_now: "タック",
  jibe_now: "ジャイブ",
  approach_mark: "マークへアプローチ",
  head_to_finish: "フィニッシュへ",
  seek: "可視ブローへ寄せる",
  cloudNote: "AWS上の実Strands Deciderが各艇の戦術を選びます。判断の期限",
  seconds: "秒",
  signIn: "サインインして実モデルを使う",
  signedOut: "サインインが必要です",
  workerStopped: "AWSの判断ワーカーは停止中です",
  debrief: "AIの振り返りを生成（Amazon Bedrock）",
  debriefLoading: "振り返りを生成中…",
  debriefFailed: "振り返りを生成できませんでした。自動では再試行しません。",
  debriefLimit: "本日の振り返りの上限に達しました。",
  debriefNote:
    "記録された判断ログだけをもとにした事後解説です。[D番号]は判断ログの番号です。",
};
const en: Record<keyof typeof ja, string> = {
  title: "Read the wind. Pick the winner.",
  sub: "Four boats. Four approaches. One changing sea.",
  prediction: "Pick your winner",
  picked: "Your prediction",
  start: "Lock prediction & start",
  choose: "Choose a boat",
  pause: "Pause",
  resume: "Resume watching",
  end: "End race",
  again: "Predict the next race",
  scenario: "Sea conditions",
  dynamic: "Evolving conditions",
  steady: "Steady wind",
  shift: "Wind shifts",
  pressure: "Pressure patches",
  mode: "Decision engine",
  preview: "Rule-based preview",
  decider: "Real Strands Decider",
  previewNote: "This preview uses fixed rules, not the real model.",
  modelNote: "The real local Decider chooses each boat's tactics.",
  connect: "Check model connection",
  offline: "Model offline",
  ready: "Model ready",
  loading: "Model loading",
  rank: "Provisional order / follow",
  rankNote: "Estimated distance remaining. Finish times determine the result.",
  decisions: "Latest tactical choices",
  noDecisions: "After the start, each boat's selected tactics appear here.",
  pending: "is deciding",
  following: "Following",
  follow: "Follow",
  helm: "On board",
  overview: "Overview",
  quality: "Graphics",
  high: "High",
  low: "Low",
  speed: "Speed",
  left: "Time left",
  wind: "True wind",
  heading: "Heading",
  tacks: "Tacks",
  chart: "Course chart",
  result: "Race result",
  hit: "You picked the winner!",
  miss: "Who will you pick next?",
  noWinner: "No valid result / prediction not scored",
  winner: "Winner",
  replay: "Review the tracks",
  export: "Save recording",
  close: "Close",
  practice: "Predict & watch",
  aborted: "Race ended",
  running: "Racing",
  paused: "Paused",
  finished: "All boats finished",
  timed_out: "Time limit",
  readyRace: "Before the start",
  applied: "Applied",
  expired: "Expired",
  rejected: "Rejected",
  failed: "Failed",
  fallback: "Holding / inference failed",
  rule: "Rule",
  real: "Decider",
  safety:
    "Simplified contact and boundary rules. Equal boat performance; different profiles and starting positions.",
  footer:
    "A game approximation, not validated winning odds or real boat performance.",
  controls: "Select a boat to follow. Space: pause / resume",
  modelError:
    "Inference failed or missed its deadline. Repeated failures end the race without a prediction result.",
  finishedBoat: "Finished",
  dns: "Did not finish",
  waiting: "Waiting",
  hold_course: "Hold course",
  tack_now: "Tack",
  jibe_now: "Jibe",
  approach_mark: "Approach mark",
  head_to_finish: "Head to finish",
  seek: "Seek visible pressure",
  cloudNote:
    "The real Strands Decider on AWS chooses each boat's tactics. Decision deadline",
  seconds: "s",
  signIn: "Sign in to use the real model",
  signedOut: "Sign-in required",
  workerStopped: "The AWS decision worker is stopped",
  debrief: "Generate AI debrief (Amazon Bedrock)",
  debriefLoading: "Writing the debrief…",
  debriefFailed:
    "The debrief could not be generated. It is not retried automatically.",
  debriefLimit: "Today's debrief limit has been reached.",
  debriefNote:
    "A post-race commentary based only on the logged decisions. [D#] refers to the decision log.",
};
type Text = typeof ja;
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
const color = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
const meta = (id: string) => FLEET.find((b) => b.id === id) ?? FLEET[0];
const tactic = (value: string, text: Text) =>
  value.startsWith("seek_visible_pressure_")
    ? text.seek
    : (text[value as keyof Text] ?? value);

function Chart({
  runtime,
  race,
  label,
}: {
  runtime: FleetRuntime;
  race: FleetRace;
  label: string;
}) {
  return (
    <svg viewBox="0 0 320 240" className="track" role="img" aria-label={label}>
      <title>{label}</title>
      <rect width="320" height="240" rx="5" fill="#276378" />
      {visiblePressure(race.scenario, race.seed, race.tick * STEP).map(
        (patch) => (
          <circle
            key={patch.id}
            cx={160 + patch.x}
            cy={195 - patch.y}
            r={patch.radius}
            fill="#0d4055"
            opacity=".35"
          />
        ),
      )}
      <line
        x1="130"
        x2="190"
        y1="195"
        y2="195"
        stroke="#e1efed"
        strokeDasharray="4 3"
      />
      <circle cx="160" cy={195 - MARK.y} r="4" fill="#ee9a59" />
      {race.boats.map((boat, i) => (
        <g key={boat.id}>
          <polyline
            fill="none"
            stroke={color(meta(boat.id).color)}
            strokeWidth="1.7"
            points={runtime.trails[i]
              .filter((p) => p.tick <= race.tick)
              .map((p) => `${160 + p.x},${195 - p.y}`)
              .join(" ")}
          />
          <path
            d="M0 -6 3 4 -3 4Z"
            fill={color(meta(boat.id).color)}
            transform={`translate(${160 + boat.x} ${195 - boat.y}) rotate(${degrees(boat.heading)})`}
          />
        </g>
      ))}
    </svg>
  );
}

function Sea({ runtime, text }: { runtime: FleetRuntime; text: Text }) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const { race, wind } = snapshot;
  const boat = race.boats[snapshot.focusIndex];
  useEffect(() => {
    if (!host.current) return;
    let dispose: () => void;
    try {
      dispose = mountScene(host.current, runtime);
    } catch {
      setFallback(true);
      let frame = 0;
      let last = 0;
      const advance = (now: number) => {
        runtime.advance(last ? now - last : 0);
        last = now;
        frame = requestAnimationFrame(advance);
      };
      frame = requestAnimationFrame(advance);
      dispose = () => cancelAnimationFrame(frame);
    }
    const hidden = () => {
      if (document.hidden) runtime.pause();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      dispose();
      runtime.pause();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [runtime]);
  const status = race.status === "ready" ? text.readyRace : text[race.status];
  return (
    <section className="sea-shell" aria-label={text.practice}>
      <div
        className="sea-canvas"
        ref={host}
        role="application"
        aria-label={text.controls}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard-focusable observation canvas handles pause only.
        tabIndex={0}
        onPointerDown={(event) => event.currentTarget.focus()}
        onKeyDown={(event) => {
          if (event.key === " " && !event.repeat) {
            event.preventDefault();
            if (runtime.race.status === "paused") runtime.resume();
            else runtime.pause();
          }
        }}
      >
        {fallback && (
          <div className="fallback-view">
            <Chart runtime={runtime} race={race} label={text.chart} />
          </div>
        )}
      </div>
      <div className="sea-toolbar">
        <span className={`status status-${race.status}`}>
          <i />
          {status}
        </span>
        <div className="view-switch">
          {(["follow", "helm", "overview"] as const).map((view) => (
            <Button
              key={view}
              size="small"
              aria-pressed={snapshot.view === view}
              onClick={() => runtime.setView(view)}
            >
              {text[view]}
            </Button>
          ))}
        </div>
      </div>
      <div className="mark-indicator">
        <span
          className="boat-dot"
          style={{ background: color(meta(boat.id).color) }}
        />{" "}
        {text.following}
        <span>{meta(boat.id).name}</span>
      </div>
      <div
        className="wind-dial"
        role="img"
        aria-label={`${text.wind} ${Math.round(degrees(wind.direction))}°`}
      >
        <div className="compass-rose" aria-hidden="true">
          <span>N</span>
          <span>E</span>
          <span>S</span>
          <span>W</span>
        </div>
        <div
          className="wind-needle"
          style={{ transform: `rotate(${degrees(wind.direction)}deg)` }}
        >
          <svg viewBox="0 0 40 80" aria-hidden="true">
            <path d="M20 4 32 40 20 34 8 40Z" fill="#ef8354" />
            <path d="M20 76 8 40 20 46 32 40Z" fill="#7d98a6" />
          </svg>
        </div>
        <small>{Math.round(degrees(wind.direction))}°</small>
      </div>
      <div className="course-chart">
        <span>{text.chart}</span>
        <Chart runtime={runtime} race={race} label={text.chart} />
      </div>
      <div className="instruments" aria-live="off">
        <div className="speed-instrument">
          <span>{text.speed}</span>
          <strong>
            {(boat.speed * 1.94384).toFixed(1)}
            <small>kn</small>
          </strong>
        </div>
        <div className="time-instrument">
          <span>{text.left}</span>
          <strong>{clock((MAX_TICKS - race.tick) * STEP)}</strong>
        </div>
        <div>
          <span>{text.wind}</span>
          <b>
            {(wind.speed * 1.94384).toFixed(1)}
            <small>kn</small>
          </b>
        </div>
        <div>
          <span>{text.heading}</span>
          <b>{Math.round(degrees(boat.heading))}°</b>
        </div>
        <div>
          <span>{text.tacks}</span>
          <b>{boat.tacks}</b>
        </div>
        <div>
          <span>{text.mode}</span>
          <b className="engine-value">
            {snapshot.mode === "decider" ? "Decider" : text.rule}
          </b>
        </div>
      </div>
      <div className="sea-footer">
        {FLEET.map((b) => (
          <span key={b.id}>
            <i className="boat-dot" style={{ background: color(b.color) }} />
            {b.name}
          </span>
        ))}
        <span>{Math.round(snapshot.fps)} fps</span>
      </div>
    </section>
  );
}

export default function ObserverApp() {
  const [runtime] = useState(() => new FleetRuntime());
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const [language, setLanguage] = useState<"ja" | "en">("ja");
  const [health, setHealth] = useState<
    "offline" | "loading" | "ready" | "signed_out" | "worker_stopped"
  >("loading");
  // undefined: still loading /config.json; null: local bridge; object: AWS.
  const [cloud, setCloud] = useState<CloudConfig | null | undefined>(undefined);
  const session = useRef<Session | null>(null);
  const [debrief, setDebrief] = useState<
    | { state: "idle" | "loading" | "failed" | "limit" }
    | { state: "done"; value: Debrief }
  >({ state: "idle" });
  const [resultOpen, setResultOpen] = useState(false);
  const [replayTick, setReplayTick] = useState<number | null>(null);
  const text = language === "ja" ? ja : en;
  const { race } = snapshot;
  const active = ["running", "paused"].includes(race.status);
  const terminal = ["finished", "timed_out", "aborted"].includes(race.status);
  useEffect(() => {
    if (active)
      document
        .querySelector<HTMLElement>(".control-panel")
        ?.scrollTo({ top: 0 });
  }, [active]);
  const connect = async (config = cloud) => {
    setHealth("loading");
    if (config) {
      const current = session.current;
      if (!current) {
        setHealth("signed_out");
        return;
      }
      try {
        const result = await cloudHealth(config, current);
        if (result.ready) {
          runtime.setTransport(
            cloudTransport(config, () => session.current),
            config.deadlineMs,
          );
          runtime.setMode("decider");
          setHealth("ready");
        } else
          setHealth(
            result.error === "worker_stopped"
              ? "worker_stopped"
              : result.error === "signed_out"
                ? "signed_out"
                : "offline",
          );
      } catch {
        setHealth("offline");
      }
      return;
    }
    try {
      const response = await fetch("/local-decider/health", {
        signal: AbortSignal.timeout(4000),
      });
      const result = await response.json();
      const ready = response.ok && result.ready === true;
      setHealth(ready ? "ready" : "offline");
      if (ready) runtime.setMode("decider");
    } catch {
      setHealth("offline");
    }
  };
  // A local health probe never starts model inference.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Probe once; reconnect is an explicit action.
  useEffect(() => {
    void (async () => {
      const config = await loadCloudConfig();
      setCloud(config);
      if (config && window.location.pathname === "/auth/callback") {
        try {
          session.current = await completeSignIn(
            config,
            window.location.search,
          );
        } catch {
          session.current = null;
        }
        // Drop the single-use code from the address bar and history.
        window.history.replaceState(null, "", "/");
      }
      await connect(config);
    })();
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    if (terminal) {
      setReplayTick(null);
      setResultOpen(true);
    }
  }, [terminal]);
  const reset = () => {
    setResultOpen(false);
    setDebrief({ state: "idle" });
    setReplayTick(null);
    runtime.configure(
      race.scenario,
      crypto.getRandomValues(new Uint32Array(1))[0] % 100000,
    );
  };
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([runtime.exportRecording()], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "snipe-fleet-replay.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const generateDebrief = async () => {
    const current = session.current;
    if (!cloud || !current) return;
    const body = debriefRequest(
      runtime.currentRaceId,
      language,
      runtime.recording(),
      race.boats.map((boat) => ({ boatId: boat.id, seconds: boat.finishTime })),
    );
    if (!body) return;
    setDebrief({ state: "loading" });
    try {
      setDebrief({
        state: "done",
        value: await requestDebrief(cloud, current, body),
      });
    } catch (error) {
      setDebrief({
        state:
          (error as Error).message === "debrief_limit" ? "limit" : "failed",
      });
    }
  };
  const canDebrief =
    Boolean(cloud) &&
    session.current !== null &&
    snapshot.logs.some((log) => log.source === "decider");
  const winners = fleetWinners(race);
  const replay =
    replayTick === null ? race : replayFleet(runtime.recording(), replayTick);
  return (
    <div className="app-shell observer-app">
      <header className="app-header">
        <div className="wordmark">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M19 4 5 29h14zM22 9v20h12z" fill="currentColor" />
            <path d="M4 32h31l-5 5H10z" fill="#ed7b46" />
          </svg>
          <div>
            <strong>Snipe AI Regatta</strong>
            <span>{text.sub}</span>
          </div>
        </div>
        <div className="header-actions">
          <Select
            size="small"
            value={snapshot.quality}
            inputProps={{ "aria-label": text.quality }}
            onChange={(event) =>
              runtime.setQuality(event.target.value as "high" | "economy")
            }
          >
            <MenuItem value="high">{text.high}</MenuItem>
            <MenuItem value="economy">{text.low}</MenuItem>
          </Select>
          <Select
            size="small"
            value={language}
            inputProps={{ "aria-label": "Language / 言語" }}
            onChange={(event) => setLanguage(event.target.value as "ja" | "en")}
          >
            <MenuItem value="ja">日本語</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </Select>
        </div>
      </header>
      <main className="sailing-layout">
        <aside className="control-panel">
          <div className="intro">
            <span className="practice-label">{text.practice}</span>
            <h1>{text.title}</h1>
          </div>
          <label className="field-label" htmlFor="engine">
            {text.mode}
          </label>
          <Select
            id="engine"
            size="small"
            fullWidth
            value={snapshot.mode}
            disabled={active}
            onChange={(event) =>
              runtime.setMode(event.target.value as "preview" | "decider")
            }
          >
            <MenuItem value="preview">{text.preview}</MenuItem>
            <MenuItem value="decider" disabled={health !== "ready"}>
              {text.decider}
            </MenuItem>
          </Select>
          <p className={`engine-note ${snapshot.mode}`}>
            {snapshot.mode === "preview"
              ? text.previewNote
              : cloud
                ? `${text.cloudNote} ${runtime.deadline / 1000}${text.seconds}`
                : text.modelNote}
          </p>
          {health === "signed_out" && cloud ? (
            <Button
              size="small"
              variant="outlined"
              onClick={() => void startSignIn(cloud)}
            >
              {text.signIn}
            </Button>
          ) : (
            health !== "ready" && (
              <>
                {health === "worker_stopped" && (
                  <p className="engine-note">{text.workerStopped}</p>
                )}
                <Button size="small" onClick={() => void connect()}>
                  {health === "loading" ? text.loading : text.connect}
                </Button>
              </>
            )
          )}
          <label className="field-label" htmlFor="scenario">
            {text.scenario}
          </label>
          <Select
            id="scenario"
            size="small"
            fullWidth
            value={race.scenario}
            disabled={active}
            onChange={(event) =>
              runtime.configure(event.target.value as Scenario)
            }
          >
            {(["dynamic", "steady", "shift", "pressure"] as const).map((s) => (
              <MenuItem key={s} value={s}>
                {text[s]}
              </MenuItem>
            ))}
          </Select>
          {race.status === "ready" ? (
            <fieldset className="prediction-options">
              <legend>{text.prediction}</legend>
              {FLEET.map((boat) => (
                <button
                  type="button"
                  key={boat.id}
                  aria-pressed={snapshot.prediction === boat.id}
                  onClick={() => runtime.predict(boat.id)}
                >
                  <span
                    className="boat-dot"
                    style={{ background: color(boat.color) }}
                  />
                  <span>
                    <strong>{boat.name}</strong>
                    <small>{boat[language]}</small>
                  </span>
                  <span className="pick-check">
                    {snapshot.prediction === boat.id ? "✓" : "○"}
                  </span>
                </button>
              ))}
            </fieldset>
          ) : (
            <div className="locked-prediction">
              <span>{text.picked}</span>
              <strong
                style={{ color: color(meta(snapshot.prediction ?? "").color) }}
              >
                {meta(snapshot.prediction ?? "").name}
              </strong>
            </div>
          )}
          {race.status === "ready" && (
            <Button
              fullWidth
              variant="contained"
              disabled={
                !snapshot.prediction ||
                (snapshot.mode === "decider" && health !== "ready")
              }
              onClick={() => runtime.start()}
            >
              {snapshot.prediction ? text.start : text.choose}
            </Button>
          )}
          {active && (
            <div className="race-actions">
              <Button
                variant="contained"
                onClick={() =>
                  race.status === "paused" ? runtime.resume() : runtime.pause()
                }
              >
                {race.status === "paused" ? text.resume : text.pause}
              </Button>
              <Button variant="outlined" onClick={() => runtime.finish()}>
                {text.end}
              </Button>
            </div>
          )}
          {terminal && (
            <Button fullWidth variant="contained" onClick={reset}>
              {text.again}
            </Button>
          )}
          <div className="fleet-standing">
            <h2>{text.rank}</h2>
            {fleetRanking(race).map((boat, index) => (
              <button
                type="button"
                key={boat.id}
                aria-pressed={race.boats[snapshot.focusIndex].id === boat.id}
                onClick={() => runtime.focus(boat.id)}
              >
                <span>{index + 1}</span>
                <i
                  className="boat-dot"
                  style={{ background: color(meta(boat.id).color) }}
                />
                <strong>{meta(boat.id).name}</strong>
                <small>
                  {boat.finishTime === null
                    ? `${(boat.speed * 1.94384).toFixed(1)} kn`
                    : text.finishedBoat}
                </small>
              </button>
            ))}
            <p>{text.rankNote}</p>
          </div>
        </aside>
        <div className="sailing-stage">
          <Sea runtime={runtime} text={text} />
          <div className="keyboard-strip">{text.controls}</div>
          <p className="rules-note">{text.safety}</p>
        </div>
        <section className="decision-feed" aria-label={text.decisions}>
          <h2>{text.decisions}</h2>
          {snapshot.pending && (
            <p className="pending-decision">
              {meta(snapshot.pending).name} {text.pending}
            </p>
          )}
          {snapshot.logs.length === 0 && <p>{text.noDecisions}</p>}
          {snapshot.logs
            .slice(-5)
            .reverse()
            .map((log) => (
              <div
                className="decision-item"
                key={`${log.boatId}-${log.observedTick}-${log.source}`}
              >
                <span
                  className="boat-dot"
                  style={{ background: color(meta(log.boatId).color) }}
                />
                <div>
                  <strong>{meta(log.boatId).name}</strong>
                  <span>{tactic(log.selected, text)}</span>
                </div>
                <small>
                  {clock(log.observedTick * STEP)}
                  <b>
                    {log.source === "decider"
                      ? text.real
                      : log.source === "preview"
                        ? text.rule
                        : text.fallback}{" "}
                    · {text[log.status]}
                  </b>
                </small>
              </div>
            ))}
        </section>
      </main>
      {snapshot.error && (
        <Alert className="model-error" severity="warning">
          {text.modelError}
        </Alert>
      )}
      <footer className="app-footer">
        <span>{text.footer}</span>
        <span>{snapshot.mode === "preview" ? text.preview : text.decider}</span>
      </footer>
      <Dialog
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{text.result}</DialogTitle>
        <DialogContent>
          <h2>
            {winners.length === 0
              ? text.noWinner
              : winners.includes(snapshot.prediction ?? "")
                ? text.hit
                : text.miss}
          </h2>
          {winners.length > 0 && (
            <p>
              {text.winner}: {winners.map((id) => meta(id).name).join(" / ")}
            </p>
          )}
          <Chart runtime={runtime} race={replay} label={text.replay} />
          <ol>
            {fleetRanking(race).map((boat) => (
              <li key={boat.id}>
                {meta(boat.id).name} —{" "}
                {boat.finishTime === null ? text.dns : clock(boat.finishTime)}
              </li>
            ))}
          </ol>
          <p id="replay-label">
            {text.replay}: {clock((replayTick ?? race.tick) * STEP)}
          </p>
          <Slider
            aria-labelledby="replay-label"
            min={0}
            max={Math.max(1, race.tick)}
            step={3}
            value={replayTick ?? race.tick}
            onChange={(_, value) => setReplayTick(value as number)}
          />
          {canDebrief && (
            <section className="debrief" aria-live="polite">
              {debrief.state === "done" ? (
                <>
                  <p>{debrief.value.text}</p>
                  <small>
                    {debrief.value.model} · {text.debriefNote}
                  </small>
                </>
              ) : (
                <>
                  <Button
                    variant="outlined"
                    disabled={debrief.state !== "idle"}
                    onClick={() => void generateDebrief()}
                  >
                    {debrief.state === "loading"
                      ? text.debriefLoading
                      : text.debrief}
                  </Button>
                  {debrief.state === "failed" && <p>{text.debriefFailed}</p>}
                  {debrief.state === "limit" && <p>{text.debriefLimit}</p>}
                </>
              )}
            </section>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={save}>{text.export}</Button>
          <Button onClick={() => setResultOpen(false)}>{text.close}</Button>
          <Button variant="contained" onClick={reset}>
            {text.again}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
