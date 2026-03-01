import "./ui/hud.css";
import { GameApp } from "./game/GameApp";
import { NetClient } from "./net/NetClient";

async function bootstrap(): Promise<void> {
  const mount = document.getElementById("app");
  if (!(mount instanceof HTMLElement)) {
    throw new Error("Missing #app container");
  }

  const net = new NetClient();

  try {
    await net.connect();
  } catch (error) {
    mount.innerHTML = `<pre style="padding:12px;color:#ff8d8d">Connection failed: ${
      error instanceof Error ? error.message : "unknown"
    }</pre>`;
    throw error;
  }

  await GameApp.create({ mount, net });
}

void bootstrap();
