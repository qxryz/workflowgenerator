import { useLocation } from "react-router-dom";

import ImagePage from "@/pages/image";
import VideoPage from "@/pages/video";
import AudioPage from "@/pages/audio";
import Seedance25Page from "@/pages/seedance-2-5";

export default function WorkbenchPage() {
    const { pathname } = useLocation();
    if (pathname.endsWith("/video")) return <VideoPage />;
    if (pathname.endsWith("/character")) return <ImagePage assetKind="character" />;
    if (pathname.endsWith("/scene")) return <ImagePage assetKind="scene" />;
    if (pathname.endsWith("/audio")) return <AudioPage />;
    if (pathname.endsWith("/sd25")) return <Seedance25Page />;
    return <ImagePage />;
}
