import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
} from "@mui/material";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  degrees,
  distance,
  MARK,
  MAX_TICKS,
  type Race,
  type Scenario,
  STEP,
  visiblePressure,
} from "sailing-sim";
import { en, ja } from "./i18n";
import { PracticeRuntime, replayAt } from "./runtime";
import { mountScene } from "./scene";
import "./legacy.css";

type Text = typeof ja;
const timeLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

function Track({
  runtime,
  race,
  text,
  large = false,
}: {
  runtime: PracticeRuntime;
  race: Race;
  text: Text;
  large?: boolean;
}) {
  const project = (x: number, y: number) => `${160 + x},${195 - y}`;
  return (
    <svg
      className={large ? "track track-large" : "track"}
      viewBox="0 0 320 240"
      role="img"
      aria-label={text.result}
    >
      <title>{text.result}</title>
      <rect width="320" height="240" rx="8" fill="#276f82" />
      {visiblePressure(race.scenario, race.seed, race.tick * STEP).map(
        (patch) => (
          <circle
            key={patch.id}
            cx={160 + patch.x}
            cy={195 - patch.y}
            r={patch.radius}
            fill="#093f52"
            opacity={Math.min(0.5, patch.extraSpeed * 0.18)}
          />
        ),
      )}
      {[0, 1].map((i) => (
        <polyline
          key={i}
          points={runtime.trails[i]
            .filter((p) => p.tick <= race.tick)
            .map((p) => project(p.x, p.y))
            .join(" ")}
          fill="none"
          stroke={i ? "#b7e0f0" : "#ffd384"}
          strokeWidth="1.5"
          opacity={i && !race.withOpponent ? 0 : 1}
        />
      ))}
      <line
        x1="130"
        x2="190"
        y1="195"
        y2="195"
        stroke="#fffaf0"
        strokeDasharray="4 3"
      />
      <circle cx="160" cy={195 - MARK.y} r="4" fill="#ed7b46" />
      <text
        x="160"
        y={180 - MARK.y}
        textAnchor="middle"
        fill="#fffaf0"
        fontSize="9"
      >
        {text.mark}
      </text>
      <text x="160" y="218" textAnchor="middle" fill="#fffaf0" fontSize="9">
        {text.finishLine}
      </text>
      {race.boats.map(
        (b, i) =>
          (!i || race.withOpponent) && (
            <g
              key={b.id}
              transform={`translate(${160 + b.x} ${195 - b.y}) rotate(${degrees(b.heading)})`}
            >
              <path
                d="M 0 -6 L 3 4 L -3 4 Z"
                fill={i ? "#b7e0f0" : "#ffd384"}
              />
            </g>
          ),
      )}
    </svg>
  );
}

function Instruments({
  runtime,
  text,
}: {
  runtime: PracticeRuntime;
  text: Text;
}) {
  const { race, wind: localWind } = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
  );
  const boat = race.boats[0];
  return (
    <div className="instruments" aria-live="off">
      <div className="speed-instrument">
        <span>{text.speed}</span>
        <strong data-testid="speed">
          {(boat.speed * 1.94384).toFixed(1)}
          <small>kn</small>
        </strong>
      </div>
      <div className="time-instrument">
        <span>{text.remaining}</span>
        <strong data-testid="time-left">
          {timeLabel((MAX_TICKS - race.tick) * STEP)}
        </strong>
      </div>
      <div>
        <span>{text.wind}</span>
        <b>
          {(localWind.speed * 1.94384).toFixed(1)}
          <small>kn</small>
        </b>
      </div>
      <div>
        <span>{text.heading}</span>
        <b>{Math.round(degrees(boat.heading))}°</b>
      </div>
      <div>
        <span>{text.vmg}</span>
        <b>
          {(
            Math.cos(boat.heading - localWind.direction) *
            boat.speed *
            1.94384
          ).toFixed(1)}{" "}
          <small>kn</small>
        </b>
      </div>
      <div>
        <span>{text.tackCount}</span>
        <b>{boat.tacks}</b>
      </div>
    </div>
  );
}

function Sea({ runtime, text }: { runtime: PracticeRuntime; text: Text }) {
  const host = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
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
      if (document.hidden) {
        keys.current.clear();
        runtime.pause();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    const release = () => {
      keys.current.clear();
      runtime.releaseInput();
    };
    window.addEventListener("blur", release);
    return () => {
      dispose();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("blur", release);
    };
  }, [runtime]);
  const keys = useRef(new Set<string>());
  const handleKey = (key: string, down: boolean, repeat = false) => {
    const normalized = key.toLowerCase();
    if (!["a", "d", "w", "s", "t", "g", " "].includes(normalized)) return false;
    if (runtime.race.status !== "running" && normalized !== " ") return true;
    if (down) keys.current.add(normalized);
    else keys.current.delete(normalized);
    if (normalized === "a" || normalized === "d")
      runtime.setControl({
        rudder: Number(keys.current.has("d")) - Number(keys.current.has("a")),
      });
    if (down && (normalized === "w" || normalized === "s"))
      runtime.setControl({
        autoTrim: false,
        mainSheet: Math.max(
          0,
          Math.min(
            1,
            runtime.control.mainSheet + (normalized === "s" ? 0.04 : -0.04),
          ),
        ),
      });
    if (down && !repeat && normalized === "t")
      runtime.setControl({ maneuver: "tack" });
    if (down && !repeat && normalized === "g")
      runtime.setControl({ maneuver: "jibe" });
    if (down && !repeat && normalized === " ") {
      if (runtime.race.status === "running") runtime.pause();
      else runtime.resume();
    }
    return true;
  };
  return (
    <section className="sea-shell" aria-label={text.practice}>
      <div className="sea-toolbar">
        <span className={`status status-${snapshot.race.status}`}>
          <i />
          {text[snapshot.race.status]}
        </span>
        <div className="view-switch">
          <Button
            size="small"
            aria-pressed={snapshot.view === "follow"}
            onClick={() => runtime.setView("follow")}
          >
            {text.follow}
          </Button>
          <Button
            size="small"
            aria-pressed={snapshot.view === "helm"}
            onClick={() => runtime.setView("helm")}
          >
            {text.helm}
          </Button>
          <Button
            size="small"
            aria-pressed={snapshot.view === "overview"}
            onClick={() => runtime.setView("overview")}
          >
            {text.overview}
          </Button>
        </div>
      </div>
      <div
        ref={host}
        className="sea-canvas"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Interactive sailing surface requires scoped keyboard focus.
        tabIndex={0}
        role="application"
        aria-label={text.focus}
        aria-describedby="keyboard-help"
        onPointerDown={(event) => event.currentTarget.focus()}
        onKeyDown={(event) => {
          if (handleKey(event.key, true, event.repeat)) event.preventDefault();
        }}
        onKeyUp={(event) => {
          if (handleKey(event.key, false)) event.preventDefault();
        }}
        onBlur={() => {
          keys.current.clear();
          runtime.releaseInput();
        }}
      >
        {fallback && (
          <div className="fallback-view">
            <Track runtime={runtime} race={snapshot.race} text={text} large />
          </div>
        )}
      </div>
      <div className="mark-indicator">
        {snapshot.race.boats[0].leg === "upwind" ? text.mark : text.downwind}
        <span>
          {Math.round(
            distance(
              snapshot.race.boats[0],
              snapshot.race.boats[0].leg === "upwind" ? MARK : { x: 0, y: 0 },
            ),
          )}{" "}
          m
        </span>
      </div>
      <div
        className="wind-dial"
        role="img"
        aria-label={`${text.wind} ${Math.round(degrees(snapshot.wind.direction))}°`}
      >
        <div className="compass-rose" aria-hidden="true">
          <span>N</span>
          <span>E</span>
          <span>S</span>
          <span>W</span>
        </div>
        <div
          className="wind-needle"
          style={{
            transform: `rotate(${degrees(snapshot.wind.direction)}deg)`,
          }}
        >
          <svg viewBox="0 0 40 80" aria-hidden="true">
            <path d="M20 4 32 40 20 34 8 40Z" fill="#ef8354" />
            <path d="M20 76 8 40 20 46 32 40Z" fill="#7d98a6" />
          </svg>
        </div>
        <small>{Math.round(degrees(snapshot.wind.direction))}°</small>
      </div>
      <div className="course-chart">
        <span>{text.chart}</span>
        <Track runtime={runtime} race={snapshot.race} text={text} />
      </div>
      <Instruments runtime={runtime} text={text} />
      <div className="sea-footer">
        <span className="player-key">{text.player}</span>
        {snapshot.race.withOpponent && (
          <span className="rival-key">{text.rival}</span>
        )}
        <span>{Math.round(snapshot.fps)} fps</span>
      </div>
      {fallback && (
        <Alert className="render-notice" severity="info">
          {text.fallback}
        </Alert>
      )}
      {snapshot.race.status === "ready" && (
        <div className="sea-caption">
          <span>Snipe</span>
          <strong>{text.focus}</strong>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [runtime] = useState(() => new PracticeRuntime());
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const [language, setLanguage] = useState<"ja" | "en">("ja");
  const [resultOpen, setResultOpen] = useState(false);
  const [replayTick, setReplayTick] = useState<number | null>(null);
  const text = language === "ja" ? ja : en;
  const { race } = snapshot;
  const boat = race.boats[0];
  const active = race.status === "running" || race.status === "paused";
  const terminal = ["finished", "timed_out", "aborted"].includes(race.status);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    if (terminal) {
      setReplayTick(null);
      setResultOpen(true);
    }
  }, [terminal]);
  const launch = () => {
    runtime.start();
    document.querySelector<HTMLElement>(".sea-canvas")?.focus();
  };
  const reset = () => {
    setResultOpen(false);
    setReplayTick(null);
    runtime.configure(race.scenario, race.withOpponent);
  };
  const hold = (direction: number) => runtime.setControl({ rudder: direction });
  const save = () => {
    const bytes = JSON.stringify(runtime.recording(), null, 2);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "snipe-practice.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const replayRace =
    replayTick === null ? race : replayAt(runtime.recording(), replayTick);
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="wordmark">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M19 4 5 29h14zM22 9v20h12z" fill="currentColor" />
            <path d="M4 32h31l-5 5H10z" fill="#ed7b46" />
          </svg>
          <div>
            <strong>Snipe AI Regatta</strong>
            <span>{text.subtitle}</span>
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
            <MenuItem value="high">{text.highQuality}</MenuItem>
            <MenuItem value="economy">{text.economy}</MenuItem>
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
            <p>{text.conditions}</p>
          </div>
          <label className="field-label" htmlFor="scenario">
            {text.scenario}
          </label>
          <Select
            id="scenario"
            fullWidth
            size="small"
            value={race.scenario}
            disabled={active}
            onChange={(event) =>
              runtime.configure(
                event.target.value as Scenario,
                race.withOpponent,
              )
            }
          >
            <MenuItem value="steady">{text.steady}</MenuItem>
            <MenuItem value="shift">{text.shift}</MenuItem>
            <MenuItem value="pressure">{text.pressure}</MenuItem>
            <MenuItem value="dynamic">{text.dynamic}</MenuItem>
          </Select>
          {race.scenario === "dynamic" && (
            <p className="weather-help">{text.dynamicHelp}</p>
          )}
          <FormControlLabel
            className="opponent-switch"
            control={
              <Switch
                size="small"
                checked={race.withOpponent}
                disabled={active}
                onChange={(_, checked) =>
                  runtime.configure(race.scenario, checked)
                }
              />
            }
            label={text.opponent}
          />
          {race.status === "ready" && (
            <Button fullWidth variant="contained" size="large" onClick={launch}>
              {text.start}
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
          <div className="trim-control">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={snapshot.control.autoTrim}
                  onChange={(_, checked) =>
                    runtime.setControl({ autoTrim: checked })
                  }
                />
              }
              label={text.autoTrim}
            />
            <span className="sheet-title" id="sheet-label">
              {text.sheet}
            </span>
            <Slider
              aria-labelledby="sheet-label"
              min={0}
              max={1}
              step={0.02}
              value={
                snapshot.control.autoTrim
                  ? boat.mainSheet
                  : snapshot.control.mainSheet
              }
              disabled={snapshot.control.autoTrim}
              onChange={(_, value) =>
                runtime.setControl({ mainSheet: value as number })
              }
            />
            <div className="sheet-labels">
              <span>W {text.tight}</span>
              <span>S {text.ease}</span>
            </div>
          </div>
          <div className="helm-actions">
            <Button
              variant="outlined"
              disabled={race.status !== "running"}
              onPointerDown={() => hold(-1)}
              onPointerUp={() => hold(0)}
              onPointerLeave={() => hold(0)}
              onPointerCancel={() => hold(0)}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") hold(-1);
              }}
              onKeyUp={() => hold(0)}
            >
              ↶ {text.left}
            </Button>
            <Button
              variant="outlined"
              disabled={race.status !== "running"}
              onPointerDown={() => hold(1)}
              onPointerUp={() => hold(0)}
              onPointerLeave={() => hold(0)}
              onPointerCancel={() => hold(0)}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") hold(1);
              }}
              onKeyUp={() => hold(0)}
            >
              {text.right} ↷
            </Button>
          </div>
          <div className="helm-actions">
            <Button
              variant="outlined"
              disabled={race.status !== "running"}
              onClick={() => runtime.setControl({ maneuver: "tack" })}
            >
              {text.tack}
            </Button>
            <Button
              variant="outlined"
              disabled={race.status !== "running"}
              onClick={() => runtime.setControl({ maneuver: "jibe" })}
            >
              {text.jibe}
            </Button>
          </div>
          <p className="model-notice">{text.notice}</p>
        </aside>
        <div className="sailing-stage">
          <Sea runtime={runtime} text={text} />
          <div className="keyboard-strip" id="keyboard-help">
            {text.controls}
          </div>
          <p className="rules-note">{text.rules}</p>
        </div>
      </main>
      <footer className="app-footer">
        <span>{text.approximation}</span>
        {race.withOpponent && <span>{text.modelNote}</span>}
      </footer>
      <Dialog
        open={resultOpen}
        onClose={() => setResultOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{text.result}</DialogTitle>
        <DialogContent>
          <p>{text.resultText}</p>
          <div className="result-layout">
            <Track runtime={runtime} race={replayRace} text={text} large />
            <div className="result-stats">
              <span>{text[race.status]}</span>
              <strong>{timeLabel(race.tick * STEP)}</strong>
              <p>
                {text.tackCount}: {boat.tacks}
              </p>
              <p>
                {text.player}:{" "}
                {boat.finishTime === null ? "—" : timeLabel(boat.finishTime)}
              </p>
              {race.withOpponent && (
                <p>
                  {text.rival}:{" "}
                  {race.boats[1].finishTime === null
                    ? "—"
                    : timeLabel(race.boats[1].finishTime as number)}
                </p>
              )}
              <p>{text.replayNote}</p>
            </div>
          </div>
          <p id="replay-label">
            {text.replayPosition}: {timeLabel((replayTick ?? race.tick) * STEP)}
          </p>
          <Slider
            aria-labelledby="replay-label"
            min={0}
            max={Math.max(1, race.tick)}
            step={3}
            value={replayTick ?? race.tick}
            onChange={(_, value) => setReplayTick(value as number)}
          />
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
