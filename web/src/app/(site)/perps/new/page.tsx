import { redirect } from "next/navigation";

/** Starting a perp lives on the start page's perp form. */
export default function NewPerpRedirect() {
  redirect("/pots/new?kind=perp");
}
