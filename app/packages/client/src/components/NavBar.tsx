import { Plus } from "lucide-solid";
import { Button } from "./ui/button.tsx";
import { Aperture } from "./Aperture.tsx";
import { Wordmark } from "./Wordmark.tsx";
import { setThemeValue, theme } from "../theme.ts";
import {
  actions,
  lockup,
  nav,
  segBtn,
  segWrap,
  sparkBtn,
  tabLink,
  tabs,
} from "./styles.ts";

export function NavBar(
  props: {
    view: () => "portions" | "status";
    setView: (v: "portions" | "status") => void;
    onAdd: () => void;
  },
) {
  return (
    <nav class={nav}>
      <div class={lockup}>
        <Aperture size={40} />
        <Wordmark size={32} />
      </div>
      <div class={actions}>
        <div class={tabs}>
          <Button
            variant="link"
            class={tabLink}
            data-active={props.view() === "portions" ? "true" : "false"}
            onClick={() => props.setView("portions")}
          >
            Portions
          </Button>
          <Button
            variant="link"
            class={tabLink}
            data-active={props.view() === "status" ? "true" : "false"}
            onClick={() => props.setView("status")}
          >
            Status
          </Button>
        </div>
        <div class={segWrap}>
          <Button
            variant="plain"
            class={segBtn}
            data-active={theme() === "dark" ? "true" : "false"}
            onClick={() => setThemeValue("dark")}
          >
            Dark
          </Button>
          <Button
            variant="plain"
            class={segBtn}
            data-active={theme() === "light" ? "true" : "false"}
            onClick={() => setThemeValue("light")}
          >
            Light
          </Button>
        </div>
        <Button
          class={sparkBtn}
          onClick={props.onAdd}
        >
          <Plus size={16} /> Add portion
        </Button>
      </div>
    </nav>
  );
}
