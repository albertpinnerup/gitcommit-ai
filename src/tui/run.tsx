/** @jsxImportSource @opentui/react */
// Mounts the one React root for an interactive run and resolves with the
// review result. Production uses a real CLI renderer; tests inject one.

import { useEffect, useState, act } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions } from "@opentui/react";
import { App, type AppDeps, type AppResult } from "./app.tsx";
import { PlanningScreen } from "./planning-screen.tsx";
import type { Plan, Settings } from "../types.ts";

export interface RunTuiOptions {
  planPromise: Promise<Plan>;
  settings: Settings;
  deps: AppDeps;
  // Injectable for tests: must be synchronous so there is no async gap between
  // renderer creation and the first root.render() / act() call. Production omits
  // this and uses createCliRenderer() (async) instead.
  makeRenderer?: () => { destroy(): void };
}

function Root({
  planPromise, settings, deps, onDone,
}: {
  planPromise: Promise<Plan>;
  settings: Settings;
  deps: AppDeps;
  onDone: (result: AppResult | { error: Error }) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const { height, width } = useTerminalDimensions();
  useEffect(() => {
    planPromise.then(
      (p) => {
        if (p.commits.length === 0) {
          onDone({ committed: [], settings });
        } else {
          setPlan(p);
        }
      },
      (error: Error) => onDone({ error }),
    );
  }, []);
  if (!plan) return <PlanningScreen />;
  return <App plan={plan} settings={settings} deps={deps} height={height} width={width} onDone={onDone} />;
}

export async function runTui({
  planPromise, settings, deps, makeRenderer,
}: RunTuiOptions): Promise<AppResult> {
  // In test mode, makeRenderer is synchronous so there is no await before
  // root.render(); the whole setup runs in the same synchronous turn, allowing
  // the test's renderOnce() to capture the initial frame immediately.
  const renderer = makeRenderer ? makeRenderer() : await createCliRenderer();
  const priorActEnv = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  if (makeRenderer) {
    // Enable React's synchronous flush so renderOnce() sees committed content,
    // mirroring what testRender() from @opentui/react/test-utils does.
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  }
  const root = createRoot(renderer as never);
  return new Promise<AppResult>((resolve, reject) => {
    const done = (result: AppResult | { error: Error }) => {
      root.unmount();
      if (makeRenderer) {
        (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = priorActEnv;
      }
      if (!makeRenderer) (renderer as { destroy(): void }).destroy();
      if ("error" in result) reject(result.error);
      else resolve(result);
    };
    const node = (
      <Root planPromise={planPromise} settings={settings} deps={deps} onDone={done} />
    );
    if (makeRenderer) {
      act(() => root.render(node));
    } else {
      root.render(node);
    }
  });
}
