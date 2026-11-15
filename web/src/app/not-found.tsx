import SiteLayout from "./(site)/layout";
import { NotFoundBody } from "./NotFoundBody";

/** Unmatched URLs: no layout above this, so it brings the site chrome. */
export default function NotFound() {
  return (
    <SiteLayout>
      <NotFoundBody />
    </SiteLayout>
  );
}
