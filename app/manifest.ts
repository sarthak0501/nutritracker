import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NutriTracker",
    short_name: "NutriTracker",
    description: "Your daily meals, nutrition, and shared progress.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#16a34a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
