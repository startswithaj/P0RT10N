import { For } from "solid-js";
import { css } from "styled-system/css";
import * as Card from "./ui/card.tsx";
import { Skeleton, SkeletonText } from "./ui/skeleton.tsx";

// Same grid + card shape as PortionsView so the layout doesn't jump when the
// friends list arrives.
const statGrid = css({
  display: "grid",
  gridTemplateColumns: { base: "1fr", sm: "repeat(3, 1fr)" },
  gap: "4",
  mt: "8",
  mb: "12",
});
const cardGrid = css({
  display: "grid",
  gridTemplateColumns: {
    base: "1fr",
    md: "repeat(2, 1fr)",
    xl: "repeat(3, 1fr)",
  },
  gap: "4",
});
const cardShell = css({
  boxShadow: "lg",
  borderWidth: "1px",
  borderColor: "border.default",
  bg: "bg.default",
});
const sectionTitle = css({
  fontFamily: "display",
  fontSize: "xl",
  color: "fg.default",
  mb: "5",
});
const statBody = css({
  p: "5",
  display: "flex",
  flexDirection: "column",
  gap: "4",
});
const cardBody = css({ p: "6" });

/** Loading placeholder for the portions dashboard. */
export function PortionsSkeleton() {
  return (
    <>
      <div class={statGrid}>
        <For each={[0, 1, 2]}>
          {() => (
            <Card.Root class={cardShell}>
              <Card.Body class={statBody}>
                <Skeleton height="3" width="24" />
                <Skeleton height="7" width="28" />
              </Card.Body>
            </Card.Root>
          )}
        </For>
      </div>
      <h2 class={sectionTitle}>Portions</h2>
      <div class={cardGrid}>
        <For each={[0, 1]}>
          {() => (
            <Card.Root class={cardShell}>
              <Card.Body class={cardBody}>
                <SkeletonText noOfLines={3} />
              </Card.Body>
            </Card.Root>
          )}
        </For>
      </div>
    </>
  );
}
