import { setup } from "rivetkit";
import { npc } from "./actors/npc";

export const registry = setup({
  use: { npc },
});
