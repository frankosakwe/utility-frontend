"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Network = "testnet" | "futurenet" | "mainnet";

interface ContractEvent {
  topic: string;
  value: string;
  contractId: string;
  timestamp: number;
  block: number;
}

interface DecodedEvent {
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  raw: ContractEvent;
}

type EventDecoder = (event: ContractEvent) => DecodedEvent;

const eventDecoders: Record<string, EventDecoder> = {
  "meter_reading": (e) => ({
    type: "meter_reading",
    severity: "info",
    message: `Meter reading update: ${e.value}`,
    raw: e,
  }),
  "balance_low": (e) => ({
    type: "balance_low",
    severity: "warning",
    message: `Low balance alert for contract ${e.contractId.slice(0, 8)}...`,
    raw: e,
  }),
  "tariff_update": (e) => ({
    type: "tariff_update",
    severity: "info",
    message: `Tariff updated to ${e.value}`,
    raw: e,
  }),
  "unauthorized_access": (e) => ({
    type: "unauthorized_access",
    severity: "critical",
    message: `Unauthorized access attempt on ${e.contractId.slice(0, 8)}...`,
    raw: e,
  }),
  "device_fault": (e) => ({
    type: "device_fault",
    severity: "critical",
    message: `Device fault reported: ${e.value}`,
    raw: e,
  }),
  "pricing_update": (e) => ({
    type: "pricing_update",
    severity: "info",
    message: `Pricing updated to ${e.value}`,
    raw: e,
  }),
};

function decodeBase64XdrString(encoded: string): string {
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const len = bytes.length;
    if (len === 0) return encoded;
    let offset = 0;
    while (offset < len && bytes[offset] !== 0) {
      offset++;
    }
    const text = new TextDecoder().decode(bytes.slice(0, offset || len));
    return text.replace(/[^\x20-\x7E]/g, "").trim() || encoded;
  } catch {
    return encoded;
  }
}

function hexToUtf8(hex: string): string {
  try {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/[^\x20-\x7E]/g, "").trim();
  } catch {
    return hex;
  }
}

interface SorobanRpcEvent {
  id?: string;
  topic: string[];
  value: { xdr?: string; data?: string };
  contractId: string;
  type?: string;
  ledger?: number;
  ledgerClosedAt?: string;
}

function parseRawEvent(raw: unknown): ContractEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as SorobanRpcEvent;

  let topicStr = "unknown";
  if (Array.isArray(r.topic) && r.topic.length > 0) {
    topicStr = decodeBase64XdrString(r.topic[0]);
    if (topicStr === r.topic[0]) {
      topicStr = r.topic[0];
    }
  } else if (typeof r.topic === "string") {
    topicStr = r.topic;
  }

  let valueStr = "";
  if (r.value) {
    const rawXdr = r.value.xdr || r.value.data;
    if (rawXdr) {
      valueStr = decodeBase64XdrString(rawXdr);
      if (valueStr === rawXdr) {
        const hexMatch = rawXdr.match(/[0-9a-fA-F]{2,}/);
        if (hexMatch) {
          valueStr = hexToUtf8(hexMatch[0]);
        }
      }
    }
  }
  if (!valueStr) valueStr = JSON.stringify(r.value);

  const contractId = r.contractId || "";
  const block = r.ledger || 0;
  const timestamp = r.ledgerClosedAt
    ? new Date(r.ledgerClosedAt).getTime()
    : Date.now();

  return { topic: topicStr, value: valueStr, contractId, timestamp, block };
}

function decodeEvent(event: ContractEvent): DecodedEvent {
  const decoder = eventDecoders[event.topic];
  if (decoder) return decoder(event);
  return {
    type: "unknown",
    severity: "info",
    message: `Unhandled event: ${event.topic}`,
    raw: event,
  };
}

const NETWORK_URLS: Record<Network, string> = {
  testnet: "wss://testnet.sorobanrpc.com",
  futurenet: "wss://futurenet.sorobanrpc.com",
  mainnet: "wss://mainnet.sorobanrpc.com",
};

export function useContractEvents(contractIds: string[], network: Network = "testnet") {
  const [events, setEvents] = useState<DecodedEvent[]>([]);
  const [latestBlock, setLatestBlock] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const baseUrl = NETWORK_URLS[network];
    const ws = new WebSocket(
      `${baseUrl}?stream=events&contracts=${contractIds.join(",")}`
    );
    wsRef.current = ws;

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        const rawEvents = Array.isArray(parsed) ? parsed : [parsed];
        let latest = 0;
        const decodedBatch: DecodedEvent[] = [];

        for (const raw of rawEvents) {
          const contractEvent = parseRawEvent(raw);
          if (!contractEvent) continue;
          if (contractEvent.block > latest) latest = contractEvent.block;
          decodedBatch.push(decodeEvent(contractEvent));
        }

        if (latest > 0) setLatestBlock(latest);
        if (decodedBatch.length > 0) {
          setEvents((prev) => [...decodedBatch, ...prev].slice(0, 200));
        }
      } catch {
        // skip malformed messages
      }
    };

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [contractIds, network]);

  useEffect(() => {
    if (contractIds.length === 0) return;
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect, contractIds]);

  return { events, latestBlock };
}
