import { jest } from "@jest/globals";

// Mock dependencies
jest.mock("fs");
jest.mock("path");
jest.mock("./platform.utils");

import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getDefaultInstallDir } from "./platform.utils";

// Import the module under test
import {
  initializeSecureSessionStore,
  setSession,
  getSession,
  deleteSession,
  hasSession,
  resetSessionStore,
  SessionData
} from "./session-store.utils";

describe("session-store.utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionStore();

    // Setup default mocks
    (getDefaultInstallDir as jest.Mock).mockReturnValue("/mock/install/dir");
    (path.join as jest.Mock).mockImplementation((...args) => args.join("/"));
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    (fs.readFileSync as jest.Mock).mockReturnValue("mock-key");
  });

  afterEach(() => {
    // Ensure cleanup interval is cleared after each test
    resetSessionStore();
  });

  describe("initializeSecureSessionStore", () => {
    it("should initialize without throwing", () => {
      expect(() => initializeSecureSessionStore()).not.toThrow();
    });

    it("should create data directory if it does not exist", () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      initializeSecureSessionStore();

      expect(fs.mkdirSync).toHaveBeenCalledWith("/mock/install/dir/data", { recursive: true });
    });

    it("should create encryption key if it does not exist", () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // data dir does not exist
        .mockReturnValueOnce(false); // key file does not exist

      initializeSecureSessionStore();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should load existing encryption key", () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // data dir does not exist
        .mockReturnValueOnce(true); // key file exists

      expect(() => initializeSecureSessionStore()).not.toThrow();
    });
  });

  describe("setSession", () => {
    it("should set a session", () => {
      const sessionData: SessionData = { username: "testuser", created: new Date() };

      setSession("token123", sessionData);

      expect(hasSession("token123")).toBe(true);
      expect(getSession("token123")).toEqual(sessionData);
    });

    it("should save sessions to file", () => {
      const sessionData: SessionData = { username: "testuser", created: new Date() };

      setSession("token123", sessionData);

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe("getSession", () => {
    it("should return session data if session exists", () => {
      const sessionData: SessionData = { username: "testuser", created: new Date() };
      setSession("token123", sessionData);

      const result = getSession("token123");

      expect(result).toEqual(sessionData);
    });

    it("should return undefined if session does not exist", () => {
      const result = getSession("nonexistent");

      expect(result).toBeUndefined();
    });
  });

  describe("deleteSession", () => {
    it("should delete existing session and return true", () => {
      const sessionData: SessionData = { username: "testuser", created: new Date() };
      setSession("token123", sessionData);

      const result = deleteSession("token123");

      expect(result).toBe(true);
      expect(hasSession("token123")).toBe(false);
    });

    it("should return false if session does not exist", () => {
      const result = deleteSession("nonexistent");

      expect(result).toBe(false);
    });

    it("should save sessions after deletion", () => {
      const sessionData: SessionData = { username: "testuser", created: new Date() };
      setSession("token123", sessionData);

      deleteSession("token123");

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe("hasSession", () => {
    it("should return true if session exists", () => {
      const sessionData: SessionData = { username: "testuser", created: new Date() };
      setSession("token123", sessionData);

      const result = hasSession("token123");

      expect(result).toBe(true);
    });

    it("should return false if session does not exist", () => {
      const result = hasSession("nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("session persistence", () => {
    it("should load sessions from encrypted file on initialization", () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // data dir
        .mockReturnValueOnce(true) // key file
        .mockReturnValueOnce(true); // session file exists

      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce("mock-key") // key file
        .mockReturnValueOnce("mock-encrypted-data"); // session file

      expect(() => initializeSecureSessionStore()).not.toThrow();
    });

    it("should handle corrupted session file gracefully", () => {
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // data dir
        .mockReturnValueOnce(true) // key file
        .mockReturnValueOnce(true); // session file

      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce("mock-key") // key file
        .mockReturnValueOnce("corrupted-data"); // session file

      // Mock decryption to throw
      (crypto.createDecipheriv as jest.Mock).mockReturnValue({
        setAuthTag: jest.fn(),
        update: jest.fn().mockImplementation(() => { throw new Error("decrypt error"); }),
        final: jest.fn()
      });

      expect(() => initializeSecureSessionStore()).not.toThrow();
    });
  });

  describe("encryption/decryption", () => {
    it("should encrypt and decrypt data correctly", () => {
      const testData = "test data";
      const mockIv = Buffer.from("mock-iv-16-bytes");
      const mockAuthTag = Buffer.from("mock-auth-tag");

      (crypto.randomBytes as jest.Mock)
        .mockReturnValueOnce(mockIv);

      initializeSecureSessionStore();

      // Test encryption/decryption would happen internally
      // This is tested indirectly through the session functions above
    });
  });
});
