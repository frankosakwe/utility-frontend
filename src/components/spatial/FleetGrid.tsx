"use client";

import { useState, useMemo } from "react";

interface FleetAsset {
  id: string;
  name: string;
  gridId: string;
  status: "online" | "offline" | "maintenance";
  uptime: number;
  lastPing: number;
  resource: number;
}

// Seeded random number generator for consistent SSR/client rendering
function seededRandom(seed: number): () => number {
  let current = seed;
  return () => {
    current = (current * 9301 + 49297) % 233280;
    return current / 233280;
  };
}

// Generate assets with seeded random for SSR safety
function generateAssets(): FleetAsset[] {
  const random = seededRandom(42); // Fixed seed for consistency
  return Array.from({ length: 48 }, (_, i) => {
    const statusRand1 = random();
    const statusRand2 = random();
    const uptimeRand = random();
    const pingRand = random();
    const resourceRand = random();
    
    return {
      id: `asset-${i}`,
      name: `Meter-${String(i + 1).padStart(3, "0")}`,
      gridId: `grid-${Math.floor(i / 6) + 1}`,
      status: ((["online", "offline", "maintenance"] as const)[
        statusRand1 > 0.15 ? 0 : statusRand2 > 0.5 ? 1 : 2
      ]),
      uptime: 95 + uptimeRand * 5,
      lastPing: 1700000000000 - Math.floor(pingRand * 60000), // Fixed base timestamp
      resource: 0.3 + resourceRand * 0.7,
    };
  });
}

const ASSETS: FleetAsset[] = generateAssets();

const STATUS_COLORS: Record<FleetAsset["status"], string> = {
  online: "bg-green-500",
  offline: "bg-red-500",
  maintenance: "bg-yellow-500",
};

export function FleetGrid() {
  const [filter, setFilter] = useState<FleetAsset["status"] | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return ASSETS.filter((a) => {
      if (filter !== "all" && a.status !== filter) return false;
      if (search && !a.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [filter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search assets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex gap-1">
          {(["all", "online", "offline", "maintenance"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                filter === s
                  ? "bg-foreground text-background border-foreground"
                  : "border-border hover:bg-accent"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filtered.map((asset) => (
          <div
            key={asset.id}
            className="rounded-lg border border-border p-3 space-y-2 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{asset.name}</span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[asset.status]}`}
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="truncate">{asset.gridId}</div>
              <div>Uptime: {asset.uptime.toFixed(1)}%</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${asset.resource * 100}%` }}
                  />
                </div>
                <span className="tabular-nums">
                  {(asset.resource * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
