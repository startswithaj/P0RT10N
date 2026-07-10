import { createSignal, Show } from "solid-js";
import { css } from "styled-system/css";
import * as Card from "./ui/card.tsx";
import * as Field from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";
import { Button } from "./ui/button.tsx";
import { Aperture } from "./Aperture.tsx";
import { Wordmark } from "./Wordmark.tsx";
import { trpc } from "../trpc.ts";

const page = css({
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  p: "6",
});
const card = css({ width: "100%", maxWidth: "sm", boxShadow: "lg" });
const brand = css({ display: "flex", alignItems: "center", gap: "3", mb: "2" });
const form = css({ display: "flex", flexDirection: "column", gap: "4" });

/** Full-screen login — shown when auth is enabled and there's no session. */
export function Login(props: { onLoggedIn: () => void }) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await trpc.auth.login.mutate({
        username: username(),
        password: password(),
      });
      props.onLoggedIn();
    } catch {
      // Generic — never distinguish username from password.
      setError("Invalid username or password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={page}>
      <Card.Root class={card}>
        <Card.Header>
          <div class={brand}>
            <Aperture size={32} />
            <Wordmark size={24} />
          </div>
          <Card.Description>Sign in to manage your portions.</Card.Description>
        </Card.Header>
        <Card.Body>
          <form class={form} onSubmit={submit}>
            <Field.Root>
              <Field.Label>Username</Field.Label>
              <Input
                autocomplete="username"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </Field.Root>
            <Field.Root invalid={error() !== null}>
              <Field.Label>Password</Field.Label>
              <Input
                type="password"
                autocomplete="current-password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
              <Show when={error()}>
                {(msg) => <Field.ErrorText>{msg()}</Field.ErrorText>}
              </Show>
            </Field.Root>
            <Button type="submit" disabled={busy()}>
              {busy() ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card.Body>
      </Card.Root>
    </div>
  );
}
