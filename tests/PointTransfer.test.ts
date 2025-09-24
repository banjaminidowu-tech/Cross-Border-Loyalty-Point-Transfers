import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_INSUFFICIENT_BALANCE = 100;
const ERR_NOT_AUTHORIZED = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_INVALID_PROGRAM = 103;
const ERR_INVALID_RECEIVER = 104;
const ERR_TRANSFER_LOCKED = 105;
const ERR_INVALID_METADATA = 107;
const ERR_TRANSFER_LIMIT_EXCEEDED = 108;
const ERR_INVALID_FEE = 109;

interface Balance {
  balance: number;
}

interface Transfer {
  sender: string;
  receiver: string;
  programId: number;
  amount: number;
  timestamp: number;
  metadata: string;
}

interface Program {
  isActive: boolean;
  owner: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class PointTransferMock {
  state: {
    transferFee: number;
    maxTransferLimit: number;
    feeRecipient: string;
    transferLock: boolean;
    minTransferAmount: number;
    transferCounter: number;
    pointBalances: Map<string, Balance>;
    transferHistory: Map<number, Transfer>;
    programRegistry: Map<number, Program>;
  } = {
    transferFee: 100,
    maxTransferLimit: 1000000,
    feeRecipient: "ST1TEST",
    transferLock: false,
    minTransferAmount: 10,
    transferCounter: 0,
    pointBalances: new Map(),
    transferHistory: new Map(),
    programRegistry: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      transferFee: 100,
      maxTransferLimit: 1000000,
      feeRecipient: "ST1TEST",
      transferLock: false,
      minTransferAmount: 10,
      transferCounter: 0,
      pointBalances: new Map(),
      transferHistory: new Map(),
      programRegistry: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  getBalance(user: string, programId: number): Result<number> {
    return { ok: true, value: this.state.pointBalances.get(`${user}-${programId}`)?.balance || 0 };
  }

  getTransferDetails(transferId: number): Result<Transfer | null> {
    return { ok: true, value: this.state.transferHistory.get(transferId) || null };
  }

  getProgramStatus(programId: number): Result<Program | null> {
    return { ok: true, value: this.state.programRegistry.get(programId) || null };
  }

  setTransferFee(newFee: number): Result<boolean> {
    if (this.caller !== this.state.feeRecipient) return { ok: false, value: false };
    if (newFee <= 0) return { ok: false, value: false };
    this.state.transferFee = newFee;
    return { ok: true, value: true };
  }

  setMaxTransferLimit(newLimit: number): Result<boolean> {
    if (this.caller !== this.state.feeRecipient) return { ok: false, value: false };
    if (newLimit <= 0) return { ok: false, value: false };
    this.state.maxTransferLimit = newLimit;
    return { ok: true, value: true };
  }

  setFeeRecipient(newRecipient: string): Result<boolean> {
    if (this.caller !== this.state.feeRecipient) return { ok: false, value: false };
    if (newRecipient === "SP000000000000000000002Q6VF78") return { ok: false, value: false };
    this.state.feeRecipient = newRecipient;
    return { ok: true, value: true };
  }

  toggleTransferLock(lock: boolean): Result<boolean> {
    if (this.caller !== this.state.feeRecipient) return { ok: false, value: false };
    this.state.transferLock = lock;
    return { ok: true, value: true };
  }

  transferPoints(receiver: string, programId: number, amount: number, metadata: string): Result<number> {
    if (this.state.transferLock) return { ok: false, value: ERR_TRANSFER_LOCKED };
    if (amount < this.state.minTransferAmount || amount > this.state.maxTransferLimit) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (receiver === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_RECEIVER };
    if (!this.state.programRegistry.get(programId)?.isActive) return { ok: false, value: ERR_INVALID_PROGRAM };
    if (metadata.length > 100) return { ok: false, value: ERR_INVALID_METADATA };
    const senderBalance = this.getBalance(this.caller, programId).value;
    if (senderBalance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.stxTransfers.push({ amount: this.state.transferFee, from: this.caller, to: this.state.feeRecipient });
    this.state.pointBalances.set(`${this.caller}-${programId}`, { balance: senderBalance - amount });
    const receiverBalance = this.getBalance(receiver, programId).value;
    this.state.pointBalances.set(`${receiver}-${programId}`, { balance: receiverBalance + amount });
    const transferId = this.state.transferCounter;
    this.state.transferHistory.set(transferId, { sender: this.caller, receiver, programId, amount, timestamp: this.blockHeight, metadata });
    this.state.transferCounter++;
    return { ok: true, value: transferId };
  }
}

describe("PointTransfer", () => {
  let contract: PointTransferMock;

  beforeEach(() => {
    contract = new PointTransferMock();
    contract.state.programRegistry.set(1, { isActive: true, owner: "ST1TEST" });
    contract.state.pointBalances.set("ST1TEST-1", { balance: 1000 });
  });

  it("transfers points successfully", () => {
    const result = contract.transferPoints("ST2TEST", 1, 500, "Transfer memo");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    expect(contract.getBalance("ST1TEST", 1).value).toBe(500);
    expect(contract.getBalance("ST2TEST", 1).value).toBe(500);
    const transfer = contract.getTransferDetails(0).value;
    expect(transfer).toEqual({ sender: "ST1TEST", receiver: "ST2TEST", programId: 1, amount: 500, timestamp: 0, metadata: "Transfer memo" });
    expect(contract.stxTransfers).toEqual([{ amount: 100, from: "ST1TEST", to: "ST1TEST" }]);
  });

  it("rejects transfer with insufficient balance", () => {
    const result = contract.transferPoints("ST2TEST", 1, 1500, "Transfer memo");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("rejects transfer with invalid amount", () => {
    const result = contract.transferPoints("ST2TEST", 1, 5, "Transfer memo");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects transfer to invalid receiver", () => {
    const result = contract.transferPoints("SP000000000000000000002Q6VF78", 1, 500, "Transfer memo");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECEIVER);
  });

  it("rejects transfer for inactive program", () => {
    contract.state.programRegistry.set(2, { isActive: false, owner: "ST1TEST" });
    const result = contract.transferPoints("ST2TEST", 2, 500, "Transfer memo");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROGRAM);
  });

  it("rejects transfer when locked", () => {
    contract.toggleTransferLock(true);
    const result = contract.transferPoints("ST2TEST", 1, 500, "Transfer memo");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TRANSFER_LOCKED);
  });

  it("rejects transfer with invalid metadata", () => {
    const longMetadata = "x".repeat(101);
    const result = contract.transferPoints("ST2TEST", 1, 500, longMetadata);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_METADATA);
  });

  it("sets transfer fee successfully", () => {
    const result = contract.setTransferFee(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.transferFee).toBe(200);
  });

  it("rejects set transfer fee by non-authorized", () => {
    contract.caller = "ST2TEST";
    const result = contract.setTransferFee(200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets max transfer limit successfully", () => {
    const result = contract.setMaxTransferLimit(500000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxTransferLimit).toBe(500000);
  });

  it("sets fee recipient successfully", () => {
    const result = contract.setFeeRecipient("ST3TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.feeRecipient).toBe("ST3TEST");
  });

  it("parses metadata with Clarity", () => {
    const metadata = stringUtf8CV("Test memo");
    expect(metadata.value).toBe("Test memo");
  });

  it("parses amount with Clarity", () => {
    const amount = uintCV(500);
    expect(amount.value).toEqual(BigInt(500));
  });
});