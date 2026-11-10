import { render } from "preact";
import "./ncf/ncf.css";
import "./ncf/ncf-panel.css";
import "./app.css";
import { App } from "./app";
import { applyTheme, savedTheme } from "./lib/theme";

applyTheme(savedTheme());
document.documentElement.classList.remove("no-js");
render(<App />, document.getElementById("root")!);
