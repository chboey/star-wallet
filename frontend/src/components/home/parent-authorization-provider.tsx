"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  requireParentAuthorization,
  type ParentAuthorizationScope,
} from "@/lib/parent-authorization";
import type { AuthorizedDevice } from "@/lib/parent-device-key";
import { ParentAttentionSheet } from "./parent-attention-sheet";
import { useStarData } from "./star-data-provider";

type Authorize = (scope: ParentAuthorizationScope) => Promise<AuthorizedDevice>;
const Context = createContext<Authorize | null>(null);
type Prompt = {
  scopeKey: string;
  authorize: () => Promise<AuthorizedDevice>;
  resolve: (device: AuthorizedDevice) => void;
  reject: (reason: Error) => void;
  controller: AbortController;
};

export function ParentAuthorizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { child } = useStarData();
  const scopeKey = `${pathname}:${child?.wallet ?? ""}`;
  const pending = useRef<Prompt | null>(null);
  const operation = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const latestScope = useRef(scopeKey);
  const results = useRef(new WeakMap<Prompt, AuthorizedDevice>());
  const cancel = useCallback(() => {
    operation.current?.abort();
    const request = pending.current;
    pending.current = null;
    request?.reject(
      new Error("Parent approval was cancelled. No action was sent."),
    );
  }, []);
  useEffect(() => {
    latestScope.current = scopeKey;
    return cancel;
  }, [scopeKey, cancel]);

  const authorize = useCallback<Authorize>(
    async (scope) => {
      if (latestScope.current !== scopeKey)
        throw new Error(
          "The selected account changed. Please try the action again.",
        );
      if (operation.current)
        throw new Error("Finish the current parent approval first.");
      const controller = new AbortController();
      operation.current = controller;
      try {
        return await requireParentAuthorization(
          scope,
          (authenticate) =>
            new Promise((resolve, reject) => {
              const request: Prompt = {
                scopeKey,
                authorize: authenticate,
                resolve,
                reject,
                controller,
              };
              pending.current = request;
              setPrompt(request);
            }),
          controller.signal,
        );
      } finally {
        if (operation.current === controller) operation.current = null;
      }
    },
    [scopeKey],
  );

  return (
    <Context.Provider value={authorize}>
      {children}
      {prompt && prompt.scopeKey === scopeKey && (
        <ParentAttentionSheet
          key={prompt.scopeKey}
          authorize={async () => {
            results.current.set(prompt, await prompt.authorize());
          }}
          onAuthorized={() => {
            const device = results.current.get(prompt);
            if (
              pending.current !== prompt ||
              !device ||
              prompt.controller.signal.aborted
            )
              return;
            pending.current = null;
            setPrompt(null);
            prompt.resolve(device);
            results.current.delete(prompt);
          }}
          onCancel={() => {
            cancel();
            setPrompt(null);
          }}
        />
      )}
    </Context.Provider>
  );
}

export function useParentAuthorization() {
  const authorize = useContext(Context);
  if (!authorize)
    throw new Error("Parent authorization must be used inside HomeAppShell.");
  return authorize;
}
