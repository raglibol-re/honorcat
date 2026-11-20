import type { MetadataRoute } from "next";

/** The installed app: HonorCat on a phone's home screen, opening full screen at the start page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "HonorCat",
    short_name: "HonorCat",
    description: "Take a side on a real Gemini question. Leave at a fair price whenever you like. Test money on Arc testnet.",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ECEAE4",
    theme_color: "#ECEAE4",
    categories: ["games", "entertainment", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Start a pot", url: "/pots/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Perps", url: "/perps", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My money", url: "/account", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
