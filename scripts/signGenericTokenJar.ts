import {
  GENERIC_TOKEN_JAR_FILL_REQUEST_TYPES,
  processJarBalances,
  type SignGenericTokenJarFillRequestParams,
  type SupportedChainId,
} from "@reserve-protocol/trusted-fillers-sdk";
import SignClient from "@walletconnect/sign-client";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  isHex,
  serializeTypedData,
  zeroAddress,
} from "viem";
import type { Address, Chain, Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, bsc, mainnet } from "viem/chains";

const config: {
  chainId: SupportedChainId;
  jarAddress: Address;
  rpcUrl?: string;
  signer:
    | {
        type: "local";
        privateKey: Hex;
      }
    | {
        type: "walletconnect";
        projectId: string;
        account: Address;
      };
  tokenList: Address[];
  validateSignatures: boolean;
  validityDuration: number;
} = {
  chainId: base.id,
  jarAddress: "0x1f55B89D575D531446a2569158F880768686B3B8",
  rpcUrl: "https://base.gateway.tenderly.co",
  signer: {
    type: "walletconnect",
    projectId: "demo",
    account: "0x170D196640702B3CE182a3406428B68F3e7b7694"
  },
  tokenList: [
    "0x23418De10d422AD71C9D5713a2B8991a9c586443",
  ],
  validateSignatures: true,
  validityDuration: 120,
};

type SignerConfig = (typeof config)["signer"];

const walletConnectDomainTypes = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

const walletConnectTypes = {
  EIP712Domain: walletConnectDomainTypes,
  ...GENERIC_TOKEN_JAR_FILL_REQUEST_TYPES,
} as const;

const genericTokenJarAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type SignatureValidation =
  | {
      mode: "permissionless" | "signature";
      owner: Address;
      ownerHasCode: boolean;
      valid: boolean;
    }
  | { error: string };

type SignedFillRequest = {
  account: Address;
  digest: Hex;
  digestMatchesRequestHash: boolean;
  request: SignGenericTokenJarFillRequestParams["request"];
  requestHash: Hex;
  signature: Hex;
  signatureValidation?: SignatureValidation;
};

type FillRequestSigner = {
  close: () => Promise<void>;
  sign: (params: SignGenericTokenJarFillRequestParams) => Promise<{ account: Address; signature: Hex }>;
};

function assertAddress(value: Address, name: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return getAddress(value);
}

function assertPrivateKey(value: Hex): Hex {
  if (!isHex(value) || value.length !== 66 || value === `0x${"0".repeat(64)}`) {
    throw new Error("config.signer.privateKey must be a nonzero bytes32 hex string");
  }

  return value;
}

function buildChain(chainId: SupportedChainId, rpcUrl?: string): Chain {
  const chain = {
    [mainnet.id]: mainnet,
    [base.id]: base,
    [bsc.id]: bsc,
  }[chainId];

  if (!rpcUrl) {
    return chain;
  }

  return {
    ...chain,
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  };
}

function getSessionAccounts(
  session: { namespaces: Record<string, { accounts?: string[] }> },
  chainId: SupportedChainId,
): Address[] {
  const prefix = `eip155:${chainId}:`;

  return Object.values(session.namespaces)
    .flatMap((namespace) => namespace.accounts ?? [])
    .filter((account) => account.toLowerCase().startsWith(prefix))
    .map((account) => assertAddress(account.slice(prefix.length) as Address, "WalletConnect account"));
}

function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") {
        return item.toString();
      }

      return item;
    },
    2,
  );
}

function createLocalSigner(signerConfig: Extract<SignerConfig, { type: "local" }>): FillRequestSigner {
  const account = privateKeyToAccount(assertPrivateKey(signerConfig.privateKey));

  return {
    close: async () => {},
    sign: async (params) => ({
      account: account.address,
      signature: await account.signTypedData({
        domain: params.domain,
        types: params.types,
        primaryType: "FillRequest",
        message: { ...params.request },
      }),
    }),
  };
}

function createWalletConnectSigner(
  signerConfig: Extract<SignerConfig, { type: "walletconnect" }>,
  chainId: SupportedChainId,
): FillRequestSigner {
  let signClient: Awaited<ReturnType<typeof SignClient.init>> | undefined;
  let topic: string | undefined;
  let account: Address | undefined;

  return {
    close: async () => {
      if (!signClient || !topic) {
        return;
      }

      try {
        await signClient.disconnect({
          topic,
          reason: { code: 6000, message: "GenericTokenJar processing complete" },
        });
      } catch {
        // Wallets may close the session first; all requested signatures were already captured.
      }
    },
    sign: async (params) => {
      if (!signerConfig.projectId) {
        throw new Error("config.signer.projectId is required for WalletConnect signing");
      }

      if (!signClient || !topic || !account) {
        signClient = await SignClient.init({
          projectId: signerConfig.projectId,
          metadata: {
            name: "Reserve Trusted Fillers",
            description: "Signs GenericTokenJar fill requests",
            url: "https://reserve.org",
            icons: [],
          },
        });

        const { uri, approval } = await signClient.connect({
          requiredNamespaces: {
            eip155: {
              methods: ["eth_signTypedData_v4"],
              chains: [`eip155:${chainId}`],
              events: ["accountsChanged", "chainChanged"],
            },
          },
        });

        if (uri) {
          console.log("WalletConnect URI:");
          console.log(uri);
          console.log(
            "Approve the session in your wallet. Signature requests will appear as jar balances are processed.",
          );
        }

        const session = await approval();
        const accounts = getSessionAccounts(session, chainId);
        account = signerConfig.account ?? accounts[0];
        topic = session.topic;

        if (!account) {
          throw new Error(`WalletConnect session did not approve an eip155:${chainId} account`);
        }

        if (
          signerConfig.account &&
          !accounts.some((approvedAccount) => isAddressEqual(approvedAccount, signerConfig.account as Address))
        ) {
          throw new Error(`Expected account ${signerConfig.account} was not approved by the WalletConnect session`);
        }
      }

      const typedData = {
        domain: {
          ...params.domain,
          chainId: BigInt(params.domain.chainId),
        },
        types: walletConnectTypes,
        primaryType: "FillRequest",
        message: { ...params.request },
      } as const;
      const signature = (await signClient.request({
        topic,
        chainId: `eip155:${chainId}`,
        request: {
          method: "eth_signTypedData_v4",
          params: [account, serializeTypedData(typedData)],
        },
      })) as Hex;

      if (!isHex(signature)) {
        throw new Error("WalletConnect returned a non-hex signature");
      }

      return { account, signature };
    },
  };
}

function createSigner(signerConfig: SignerConfig, chainId: SupportedChainId): FillRequestSigner {
  return signerConfig.type === "walletconnect"
    ? createWalletConnectSigner(signerConfig, chainId)
    : createLocalSigner(signerConfig);
}

async function validateSignature(
  client: PublicClient,
  params: SignGenericTokenJarFillRequestParams,
  signature: Hex,
): Promise<SignatureValidation> {
  try {
    const owner = await client.readContract({
      address: params.jarAddress,
      abi: genericTokenJarAbi,
      functionName: "owner",
      authorizationList: undefined,
    });

    if (owner === zeroAddress) {
      return {
        mode: "permissionless",
        owner,
        ownerHasCode: false,
        valid: true,
      };
    }

    const ownerCode = await client.getCode({ address: owner });
    const valid = await client.verifyTypedData({
      address: owner,
      domain: params.domain,
      types: params.types,
      primaryType: "FillRequest",
      message: { ...params.request },
      signature,
    });

    return {
      mode: "signature",
      owner,
      ownerHasCode: Boolean(ownerCode),
      valid,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const jarAddress = assertAddress(config.jarAddress, "config.jarAddress");
  const tokenList = config.tokenList.map((token) => assertAddress(token, "config.tokenList"));
  const chain = buildChain(config.chainId, config.rpcUrl);
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  }) as unknown as PublicClient;
  const signer = createSigner(config.signer, config.chainId);
  const signedFillRequests: SignedFillRequest[] = [];

  try {
    const processResult = await processJarBalances({
      chainId: config.chainId,
      client,
      jarAddress,
      tokenList,
      validityDuration: config.validityDuration,
      signFillRequest: async (params) => {
        const { account, signature } = await signer.sign(params);
        const signatureValidation = config.validateSignatures
          ? await validateSignature(client, params, signature)
          : undefined;

        signedFillRequests.push({
          account,
          digest: params.digest,
          digestMatchesRequestHash: params.digest.toLowerCase() === params.requestHash.toLowerCase(),
          request: params.request,
          requestHash: params.requestHash,
          signature,
          signatureValidation,
        });

        if (signatureValidation && "valid" in signatureValidation && !signatureValidation.valid) {
          throw new Error(`Invalid signature for jar owner ${signatureValidation.owner}`);
        }

        if (signatureValidation && "error" in signatureValidation) {
          throw new Error(`Signature validation failed: ${signatureValidation.error}`);
        }

        return signature;
      },
    });

    console.log(
      stringify({
        jarAddress,
        tokenList,
        processResult,
        signedFillRequests,
      }),
    );
  } finally {
    await signer.close();
  }
}

await main();
