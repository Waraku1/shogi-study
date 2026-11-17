import { QuickLearn } from '../learning/QuickLearn';
import { accountNamespace } from '../learning/types';
import { useEffect, useState } from "react";
import { Square } from "tsshogi";
import type { Move } from "tsshogi";
import { Board } from "./Board";
import { positionFromSFEN, legalMoves } from "./game";
import type { MoveSource } from "./game";
type Snapshot = {
  type: "snapshot";
  id: string;
  players: { id: string; displayName: string }[];
  moves: string[];
  remaining: number[];
  since: number | null;
  status: string;
  result: string | null;
  seq: number;
  ply: number;
  sfen: string;
  serverNow: number;
};
async function api(path: string, method = "GET") {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error);
  return b;
}
export function Online({ back }: { back: () => void }) {
  const [me, setMe] = useState<{ id: string; displayName: string } | null>(
      null,
    ),
    [room, setRoom] = useState(
      new URLSearchParams(location.search).get("room") ?? "",
    ),
    [state, setState] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("Disconnected"),
    [socket, setSocket] = useState<WebSocket | null>(null),
    [selected, setSelected] = useState<MoveSource | null>(null),
    [promote, setPromote] = useState<Move[] | null>(null),
    [tick, setTick] = useState(Date.now()),
    [received, setReceived] = useState(Date.now()),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    api("/me")
      .then((b) => setMe(b.user))
      .catch(() => {});
    const t = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (me && room && !state)
      api(`/rooms/${room}/snapshot`)
        .then((b) => {
          setState(b);
          setReceived(Date.now());
        })
        .catch(() => {});
  }, [me?.id]);
  useEffect(() => {
    if (!me || !state?.id) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let ws: WebSocket;
    const connect = () => {
      setConnection("Connecting");
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/rooms/${state.id}/ws`,
      );
      setSocket(ws);
      ws.onopen = () => setConnection("Connected");
      ws.onmessage = (e) => {
        const b = JSON.parse(e.data);
        if (b.type === "error") {
          setError(b.error);
          return;
        }
        setState((old) => (old && old.seq > b.seq ? old : b));
        setReceived(Date.now());
        setSelected(null);
        setPromote(null);
      };
      ws.onclose = (e) => {
        setConnection("Disconnected");
        if (!stopped && e.code !== 4001 && e.code !== 4003)
          timer = setTimeout(connect, 500);
        if (e.code === 4003) setError("Session expired. Sign in again.");
      };
      ws.onerror = () => setError("Connection failed");
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [me?.id, state?.id, retry]);
  const action = async (path: string, method = "POST") => {
    try {
      setError("");
      const b = await api(path, method);
      if (b.type === "snapshot") {
        setState(b);
        setReceived(Date.now());
        setRoom(b.id);
        history.replaceState(null, "", `?room=${b.id}`);
      }
      return b;
    } catch (e) {
      setError(String(e));
    }
  };
  const send = (usi: string) => {
    socket?.send(
      JSON.stringify({
        type: "move",
        id: crypto.randomUUID(),
        ply: state!.ply,
        usi,
      }),
    );
    setSelected(null);
    setPromote(null);
  };
  const pos = state ? positionFromSFEN(state.sfen) : null;
  return (
    <main className="online-room">
      <button disabled={state?.status === "active"} onClick={back}>
        Local practice
      </button>
      <h1>Online Shogi</h1>
      <p>Invitation rooms · 10-minute sudden death · No engine assistance</p>
      {error && <p role="alert">{error}</p>}
      {!me ? (
        <button
          onClick={async () => {
            try {
              const r = await fetch("/api/auth/sign-in/social", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  provider: "google",
                  callbackURL: location.href,
                }),
              });
              const b = await r.json();
              if (!r.ok) throw new Error(b.error ?? b.message);
              location.assign(b.url);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Sign in with Google
        </button>
      ) : (
        <>
          <p>Signed in as {me.displayName}</p>
          <button
            onClick={async () => {
              try {
                await api("/auth/sign-out", "POST");
                setMe(null);
                setState(null);
                socket?.close();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Sign out
          </button>
          <button onClick={() => void action("/rooms")}>Create room</button>
          <label>
            Invite code
            <input
              aria-label="Invite code"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
            />
          </label>
          <button onClick={() => void action(`/rooms/${room}/join`)}>
            Join room
          </button>
        </>
      )}
      {state && pos && (
        <>
          <p data-testid="connection">{connection}</p>
          <button
            onClick={() => {
              socket?.close();
              setRetry((v) => v + 1);
            }}
          >
            Reconnect
          </button>
          <p>
            Invite URL:{" "}
            <a href={`?room=${state.id}`}>
              {location.origin}/?room={state.id}
            </a>
          </p>
          <h2>
            {state.result ??
              (state.status === "waiting"
                ? "Waiting for opponent"
                : pos.color + " to move")}
          </h2>
          <p>
            {state.players
              .map((p, i) => `${i === 0 ? "Black" : "White"}: ${p.displayName}`)
              .join(" · ")}
          </p>
          <p data-testid="clocks">
            {state.remaining
              .map((ms, i) => {
                const remaining = Math.max(
                  0,
                  ms -
                    (state.status === "active" && i === state.ply % 2
                      ? state.serverNow - state.since! + tick - received
                      : 0),
                );
                return `${i === 0 ? "Black" : "White"} ${Math.ceil(remaining / 1000)}s`;
              })
              .join(" · ")}
          </p>
          <div className="online-learning-layout"><div><Board
            position={pos}
            selected={selected}
            disabled={
              !me ||
              connection !== "Connected" ||
              state.status !== "active" ||
              state.players[state.ply % 2]?.id !== me.id ||
              !!promote
            }
            onHand={setSelected}
            onSelect={(sq: Square) => {
              if (selected) {
                const options = [...legalMoves(pos, selected)].filter((m) =>
                  m.to.equals(sq),
                );
                if (options.length === 1) {
                  send(options[0].usi);
                  return;
                }
                if (options.length > 1) {
                  setPromote(options);
                  return;
                }
                setError("Illegal move");
              }
              if (pos.board.at(sq)?.color === pos.color) setSelected(sq);
              else setSelected(null);
            }}
          />
          </div>{me && <QuickLearn key={me.id} namespace={accountNamespace(me.id)} available={connection === 'Connected' && (state.status === 'waiting' || (state.status === 'active' && state.players[state.ply % 2]?.id !== me.id))} contextKey={`${state.id}:${state.status}:${state.ply}:${connection}`} />}</div>
          {promote && (
            <div role="dialog" aria-label="Choose promotion">
              {promote.map((m) => (
                <button key={m.usi} onClick={() => send(m.usi)}>
                  {m.promote ? "Promote" : "Keep unpromoted"}
                </button>
              ))}
            </div>
          )}
          <button
            disabled={state.status !== "active"}
            onClick={() => void action(`/rooms/${state.id}/resign`)}
          >
            Resign online game
          </button>
          <ol data-testid="online-record">
            {state.moves.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ol>
          <code data-testid="online-sfen">{state.sfen}</code>
        </>
      )}
    </main>
  );
}
