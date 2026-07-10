import { notFound } from "next/navigation";
import { ComponentGallery } from "./component-gallery";

export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <ComponentGallery />;
}
