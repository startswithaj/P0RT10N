import { Show } from "solid-js";
import { css } from "styled-system/css";
import { Eye, EyeOff } from "lucide-solid";
import { IconButton } from "./ui/icon-button.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { eyebrow, section } from "./bundle-styles.ts";

// The S3 credentials block on the bundle screen: access key, masked secret
// (reveal toggle), endpoint and bucket, each with a copy button.

const credCard = css({
  bg: "bg.default",
  borderWidth: "1px",
  borderColor: "border.default",
  rounded: "l2",
  px: "4",
  boxShadow: "lg",
});
const fieldRow = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "3",
  py: "3",
  borderBottomWidth: "1px",
  borderColor: "border.default",
  _last: { borderBottomWidth: "0" },
});
const fieldMeta = css({ minW: "0" });
const fieldLabel = css({
  fontSize: "xs",
  color: "fg.muted",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  mb: "1",
});
const fieldValue = css({
  fontFamily: "body",
  fontSize: "sm",
  color: "fg.default",
  wordBreak: "break-all",
});
const valueRow = css({ display: "flex", alignItems: "center", gap: "2" });

const DOTS = "••••••••••••••••••••••••";

export function CredentialsCard(
  props: {
    accessKey: string;
    secret: string;
    endpoint: string;
    bucket: string;
    revealed: () => boolean;
    setRevealed: (fn: (r: boolean) => boolean) => void;
    copied: () => string | null;
    onCopy: (id: string, v: string) => void;
  },
) {
  return (
    <div class={section}>
      <div class={eyebrow}>S3 credentials</div>
      <div class={credCard}>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Access key</div>
            <div class={fieldValue}>{props.accessKey}</div>
          </div>
          <CopyButton
            id="ak"
            value={props.accessKey}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        </div>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Secret key</div>
            <div class={fieldValue}>
              {props.revealed() ? props.secret : DOTS}
            </div>
          </div>
          <div class={valueRow}>
            <IconButton
              variant="outline"
              size="sm"
              aria-label="Reveal"
              onClick={() => props.setRevealed((r) => !r)}
            >
              <Show when={props.revealed()} fallback={<Eye size={15} />}>
                <EyeOff size={15} />
              </Show>
            </IconButton>
            <CopyButton
              id="sk"
              value={props.secret}
              copied={props.copied}
              onCopy={props.onCopy}
            />
          </div>
        </div>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Endpoint</div>
            <div class={fieldValue}>{props.endpoint}</div>
          </div>
          <CopyButton
            id="ep"
            value={props.endpoint}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        </div>
        <div class={fieldRow}>
          <div class={fieldMeta}>
            <div class={fieldLabel}>Bucket</div>
            <div class={fieldValue}>{props.bucket}</div>
          </div>
          <CopyButton
            id="bk"
            value={props.bucket}
            copied={props.copied}
            onCopy={props.onCopy}
          />
        </div>
      </div>
    </div>
  );
}
