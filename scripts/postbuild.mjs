// GitHub Pages serves 404.html for unknown paths; copying index.html there lets the router handle
// deep links such as /global-macro-dashboard/status.
import { copyFileSync } from "node:fs";
copyFileSync("dist/index.html", "dist/404.html");
