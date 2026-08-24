import HomeClient from "./components/HomeClient";
import { getBoardPayload } from "@/lib/board";
import { defaultBoardViewData, mapBoardActivity, mapBoardRow } from "./data/mock";
import type { BoardApiActivity, BoardApiRow } from "./data/mock";

export const dynamic = "force-dynamic";

export default async function Home() {
  const payload = await getBoardPayload();
  const board = payload ? { stats: payload.stats, leaderboard: [...payload.top, ...payload.rows].map((row, index) => mapBoardRow(row as BoardApiRow, index)), activity: payload.activity.map((event, index) => mapBoardActivity(event as BoardApiActivity, index)) } : defaultBoardViewData;
  return <HomeClient initialBoard={board} />;
}
