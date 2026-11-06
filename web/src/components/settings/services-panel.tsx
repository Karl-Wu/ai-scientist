"use client";

import { useSettingsT as useT } from "@/components/settings/use-settings-t";

import { useCallback, useEffect, useState } from "react";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsLink } from "@/components/settings-link";
import {
  connectPaperclipConnector,
  getPaperclipConnector,
  type PaperclipConnectorStatus,
} from "@/lib/mcp";
import { cn } from "@/lib/utils";
import { GetKeyLink, KeyRow, useCredentialStatus, type CredentialStatus, type KeyDef } from "./key-row";
import { SettingsCard, SettingsError, SettingsHeader } from "./primitives";

const SEARCH_KEY_DEFS: KeyDef[] = [
  {
    id: "exa",
    bodyField: "exaApiKey",
    label: "Exa API key",
    placeholder: "exa-…",
    keysUrl: "https://dashboard.exa.ai/api-keys",
    hint: "Direct Exa web + code search. Without it, web search still works via a free Exa fallback.",
  },
];

const PAPERCLIP_KEY_DEF: KeyDef = {
  id: "paperclip",
  bodyField: "paperclipApiKey",
  label: "Paperclip API key",
  placeholder: "gxl_…",
  keysUrl: "https://paperclip.gxl.ai/keys",
  hint: "Checked with Paperclip before it is saved. The connector reads the key from .env by name, so it is never copied into the connector settings.",
  savedNote: "Saved. New chat tabs can search Paperclip — no restart needed.",
};

/**
 * Paperclip literature search: saving the key adds a global MCP connector
 * that sends it (server agent/paperclip.ts); this card also reports and
 * repairs that connector, e.g. for a key set in .env by hand.
 */
function PaperclipCard({
  status,
  onStatus,
}: {
  status: CredentialStatus | null;
  onStatus: (status: CredentialStatus) => void;
}) {
  const t = useT();
  const [connector, setConnector] = useState<PaperclipConnectorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConnector(await getPaperclipConnector());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the Paperclip connector");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectPaperclipConnector();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not turn on the Paperclip connector");
    } finally {
      setBusy(false);
    }
  };

  const keySet = connector?.keySet ?? Boolean(status?.paperclip?.set);
  const ready = Boolean(connector?.name && connector.usesKey && connector.enabled);
  const signsInWithoutKey = Boolean(connector?.name && connector.enabled && !connector.usesKey);
  const name = <code className="font-mono">{connector?.name}</code>;

  return (
    <SettingsCard
      id="paperclip"
      title={t("Paperclip literature search")}
      description={t("Lets the agent search and read papers, preprints, clinical trials, FDA documents and patents. Saving a key adds a Paperclip connector shared by every project.")}
    >
      <KeyRow
        def={PAPERCLIP_KEY_DEF}
        current={status?.paperclip}
        onStatus={(next) => {
          onStatus(next);
          void load();
        }}
      />
      <SettingsError className="mt-3">{error ?? connector?.error ?? null}</SettingsError>
      {connector && !connector.error && (keySet || signsInWithoutKey) ? (
        <div
          role="status"
          className={cn(
            "mt-3 flex items-center gap-2 rounded-md border px-2.5 py-2 text-[11px]",
            ready || (!keySet && signsInWithoutKey)
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          )}
        >
          {ready || (!keySet && signsInWithoutKey) ? (
            <CheckCircle2Icon className="size-3.5 shrink-0" />
          ) : (
            <AlertCircleIcon className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            {ready ? (
              <>{t("Connector")}{" "}{name} {" "}{t("is on for every project.")}</>
            ) : !keySet ? (
              <>{t("Connector")}{" "}{name} {" "}{t("signs in to Paperclip without a key.")}</>
            ) : !connector.name ? (
              t("Your key is saved, but there is no Paperclip connector.")
            ) : !connector.usesKey ? (
              <>{t("Connector")}{" "}{name} {" "}{t("signs in another way and does not use this key.")}</>
            ) : (
              <>{t("Connector")}{" "}{name} {" "}{t("is turned off.")}</>
            )}
          </span>
          {keySet && !ready ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              disabled={busy}
              onClick={() => void connect()}
            >
              {busy ? t("Turning on…") : connector.usesKey || !connector.name ? t("Turn on") : t("Use this key")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {connector && !keySet && !signsInWithoutKey ? (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {t("No key? Add")}{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{connector.url}</code> {" "}{t("under")}{" "}
          <SettingsLink tab="connectors">{t("Connectors")}</SettingsLink> {t("and sign in with your Paperclip account instead.")}{" "}</p>
      ) : null}
    </SettingsCard>
  );
}

export function ServicesPanel() {
  const t = useT();
  const { status, setStatus, loading, error } = useCredentialStatus();

  return (
    <div className="flex flex-col gap-4">
      <SettingsHeader
        title={t("Services")}
        description={
          <>
            {t("Keys for the tools AI Scientist uses besides models. They stay on this machine (saved to")}{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">.env</code>{t(") and are used only to connect to the services you choose.")}{" "}</>
        }
        appliesTo="immediately"
      />

      <SettingsError>{error}</SettingsError>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("Loading…")}</p>
      ) : (
        <>
          <SettingsCard
            id="web-search"
            title={t("Web search")}
            description={t("All optional: web search, page fetching, and GitHub reading work without any of them.")}
          >
            <div className="flex flex-col gap-5">
              {SEARCH_KEY_DEFS.map((def) => (
                <KeyRow key={def.id} def={def} current={status?.[def.id]} onStatus={setStatus} />
              ))}
            </div>
          </SettingsCard>
          <PaperclipCard status={status} onStatus={setStatus} />
        </>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("A few knobs are read from")}{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-[10px]">.env</code> {t("at startup only — e.g.")}{" "}<code className="rounded bg-muted px-1 py-0.5 text-[10px]">GITHUB_TOKEN</code> {t("(update checks) and")}{" "}<code className="rounded bg-muted px-1 py-0.5 text-[10px]">HTTPS_PROXY</code>{" "}
        {t("(outbound proxy). Restart AI Scientist after changing them.")}{" "}</p>
    </div>
  );
}
