// HonorCatPots ABI (contracts/src/HonorCatPots.sol, deployed at deployments/5042002.pots.json).
// Regenerate: forge inspect HonorCatPots abi --json.
export const potsAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "usdc_",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ATTEST_TIMEOUT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "CAP_PER_CENTI_CONTRACT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "COOLDOWN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEPOSIT_TAG",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DEPTH_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "EXIT_REQUEST_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "HANDSHAKE_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "KIND_BOWL",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "KIND_EXIT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "KIND_JOIN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "KIND_NET",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_TOLERANCE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_GRACE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_LOCKOUT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "NO",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "OUTCOME_NO",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "OUTCOME_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "OUTCOME_VOID",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "OUTCOME_YES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "P",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "WINDOW_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "YES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "abandonExit",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "abandonJoin",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancel",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "capFor",
    "inputs": [
      {
        "name": "contracts5c",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimable",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "create",
    "inputs": [
      {
        "name": "c",
        "type": "tuple",
        "internalType": "struct HonorCatPots.CreateParams",
        "components": [
          {
            "name": "conditionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resolver",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "side",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "notional",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bandCenter",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "tolerance",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "closeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "grace",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "window",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "minSamples",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      },
      {
        "name": "d",
        "type": "tuple",
        "internalType": "struct HonorCatPots.DepthAttestation",
        "components": [
          {
            "name": "conditionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "contracts5c",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "closeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "validUntil",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "depthSigs",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "auth",
        "type": "tuple",
        "internalType": "struct HonorCatPots.Authorization",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "validAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "v",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "s",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "depositNonce",
    "inputs": [
      {
        "name": "action",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "depthDigest",
    "inputs": [
      {
        "name": "d",
        "type": "tuple",
        "internalType": "struct HonorCatPots.DepthAttestation",
        "components": [
          {
            "name": "conditionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "contracts5c",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "closeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "validUntil",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "exitRequestDigest",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "notional",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expire",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "feeBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getApproved",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "globalMaxNotional",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "handshake",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "priceYes",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "notional",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sigYes",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "sigNo",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "handshakeDigest",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "priceYes",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "notional",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isApprovedForAll",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "levels",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "net",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "bowl",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "setAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lockout",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextPotId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "noPart",
    "inputs": [
      {
        "name": "n",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "p",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "outcomeDigest",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct HonorCatPots.OutcomeAttestation",
        "components": [
          {
            "name": "potId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "conditionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "outcome",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pot",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct HonorCatPots.Pot",
        "components": [
          {
            "name": "conditionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resolver",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "notional",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "depYes",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "depNo",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "escrowYes",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "escrowNo",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bandCenter",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "tolerance",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "window",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "minSamples",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "feeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "creatorSide",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum HonorCatPots.State"
          },
          {
            "name": "closeTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "cooldownUntil",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "nonce",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "joiner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "exitSide",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "requestTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exitNotional",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestExit",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "notional",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestExitFor",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "notional",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestJoin",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "auth",
        "type": "tuple",
        "internalType": "struct HonorCatPots.Authorization",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "validAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "v",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "s",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "resolveExit",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct HonorCatPots.WindowAttestation",
        "components": [
          {
            "name": "potId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nonce",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowStart",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "sampleCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "priceYes",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "valid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "sigs",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "resolveJoin",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct HonorCatPots.WindowAttestation",
        "components": [
          {
            "name": "potId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nonce",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowStart",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "sampleCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "priceYes",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "valid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "sigs",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "safeTransferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "safeTransferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setApprovalForAll",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFeeBps",
    "inputs": [
      {
        "name": "bps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setGlobalMaxNotional",
    "inputs": [
      {
        "name": "max",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setLevels",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "net",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "bowl",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "p",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct HonorCatPots.OutcomeAttestation",
        "components": [
          {
            "name": "potId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "conditionId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "outcome",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "sigs",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sigNonce",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "takeover",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "auth",
        "type": "tuple",
        "internalType": "struct HonorCatPots.Authorization",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "validAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "v",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "s",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tokenOf",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "tokenURI",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalClaimable",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "triggerLevel",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct HonorCatPots.WindowAttestation",
        "components": [
          {
            "name": "potId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nonce",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowStart",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "sampleCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "priceYes",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "valid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "sigs",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "usdc",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "windowDigest",
    "inputs": [
      {
        "name": "a",
        "type": "tuple",
        "internalType": "struct HonorCatPots.WindowAttestation",
        "components": [
          {
            "name": "potId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nonce",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowStart",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "windowEnd",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "sampleCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "priceYes",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "valid",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "worstCase",
    "inputs": [
      {
        "name": "side",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "n",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "c",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "t",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "yesPart",
    "inputs": [
      {
        "name": "n",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "p",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "approved",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ApprovalForAll",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExitFailed",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExitRequested",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "notional",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "requestTime",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeBpsSet",
    "inputs": [
      {
        "name": "feeBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "GlobalMaxNotionalSet",
    "inputs": [
      {
        "name": "max",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Handshake",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "price",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "notional",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JoinFailed",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JoinRequested",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "joiner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "requestTime",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "escrow",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Joined",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "entryPrice",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "depYes",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "depNo",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LevelTriggered",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "priceYes",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LevelsSet",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "net",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "bowl",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paid",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentDeferred",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PotCreated",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "notional",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bandCenter",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "tolerance",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "escrow",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PotDivided",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "exitSide",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "notional",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "price",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "paidYes",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "paidNo",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PotExpired",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "paidYes",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "paidNo",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PotSettled",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "outcome",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "paidYes",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "paidNo",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TakenOver",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "side",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "paidExiter",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TakeoverOffered",
    "inputs": [
      {
        "name": "potId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "taker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AboveCap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadParams",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Cooldown",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ERC721IncorrectOwner",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC721InsufficientApproval",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC721InvalidApprover",
    "inputs": [
      {
        "name": "approver",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC721InvalidOperator",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC721InvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC721InvalidReceiver",
    "inputs": [
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC721InvalidSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC721NonexistentToken",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExpiredSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAttestation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToWithdraw",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OutsideBand",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PausedForNewPots",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "TooEarly",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TooLate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongState",
    "inputs": []
  }
] as const;
