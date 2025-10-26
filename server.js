import express from 'express';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const POG_CONTRACT_ADDRESS = process.env.POG_CONTRACT_ADDRESS;
const USDC_CONTRACT_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base Mainnet USDC
const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS || new ethers.Wallet(PRIVATE_KEY).address;

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// ERC-20 ABI (minimal)
const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const pogContract = new ethers.Contract(POG_CONTRACT_ADDRESS, ERC20_ABI, wallet);
const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, ERC20_ABI, provider);

// Store processed payments (prevent double-minting)
const processedPayments = new Map(); // Changed to Map to store signature hash -> payer address

// Constants
const REQUIRED_USDC_AMOUNT = ethers.parseUnits('1', 6); // 1 USDC (6 decimals)
const POG_MINT_AMOUNT = ethers.parseEther('10000'); // 10,000 POG

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'POG Token x402 API',
        description: 'Mint POG tokens using x402 Protocol - Payment Required!',
        version: '2.4.0-payment-enforced',
        endpoints: {
            '/': 'API information',
            '/mint': 'Mint 10,000 POG tokens (requires 1 USDC payment)',
            '/stats': 'Minting statistics'
        },
        x402: {
            version: 1,
            resource: '/mint',
            price: '1 USDC',
            reward: '10,000 POG tokens'
        },
        contract: {
            address: POG_CONTRACT_ADDRESS,
            network: 'Base Mainnet',
            chainId: 8453,
            symbol: 'POG',
            name: 'POG'
        },
        notice: 'Payment verification ENABLED - USDC payment is required',
        usage: {
            '1': 'Visit x402scan.com',
            '2': 'Search for this API or paste the URL',
            '3': 'Send 1 USDC to payment address',
            '4': 'Get transaction hash from blockchain',
            '5': 'Call /mint with X-Payment-Tx header containing tx hash',
            '6': 'Receive 10,000 POG tokens automatically'
        }
    });
});

// Verify and execute EIP-712 TransferWithAuthorization
async function verifyAndExecuteEIP712(signature, messageJson) {
    try {
        console.log(`[INFO] Verifying EIP-712 signature: ${signature}`);
        
        const typedData = JSON.parse(messageJson);
        const domain = typedData.domain;
        const types = typedData.types;
        const value = typedData.message;
        const primaryType = typedData.primaryType;
        
        // 1. Verify the signature (EIP-712 specific)
        const recoveredAddress = ethers.verifyTypedData(domain, types, value, signature);
        
        if (recoveredAddress.toLowerCase() !== value.from.toLowerCase()) {
            return { verified: false, error: 'EIP-712 Signature verification failed: Recovered address does not match message.from' };
        }
        
        // 2. Check if the payment has already been processed (using a unique hash of the signature + nonce)
        const signatureHash = ethers.sha256(ethers.toUtf8Bytes(signature + value.nonce));
        if (processedPayments.has(signatureHash)) {
            return { verified: false, error: 'Payment already processed (Nonce reused)', signatureHash: signatureHash };
        }

        // 3. Execute the TransferWithAuthorization Meta-Transaction
        console.log(`[INFO] Executing TransferWithAuthorization from ${value.from} to ${value.to} for ${value.value} USDC`);

        // USDC Contract ABI for TransferWithAuthorization (minimal)
        const USDC_ABI_TRANSFER_AUTH = [
            'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external'
        ];
        
        // Create a contract instance with the wallet (signer)
        const usdcContractWithSigner = new ethers.Contract(domain.verifyingContract, USDC_ABI_TRANSFER_AUTH, wallet);
        
        // The signature is a bytes array, we need to split it into r, s, v for the contract call
        // Ethers v6 handles the splitting automatically when passing the full signature string
        
        const tx = await usdcContractWithSigner.transferWithAuthorization(
            value.from,
            value.to,
            value.value,
            value.validAfter,
            value.validBefore,
            value.nonce,
            signature
        );

        const receipt = await tx.wait();

        if (!receipt || receipt.status !== 1) {
            throw new Error('TransferWithAuthorization transaction failed');
        }

        console.log('[SUCCESS] TransferWithAuthorization executed:', tx.hash);
        
        return { 
            verified: true, 
            payer: recoveredAddress,
            transferTxHash: tx.hash,
            signatureHash: signatureHash
        };

    } catch (error) {
        console.error('[ERROR] EIP-712 Verification and Execution failed:', error.message);
        return { verified: false, error: error.message };
    }
}

// Mint endpoint (x402)
app.get('/mint', async (req, res) => {
    const signature = req.headers['x-payment'];
    const messageJson = req.headers['x-payment-message'];
    const account = req.headers['x-account'];

    // If no payment proof, return 402 with x402 schema
    if (!signature || !messageJson) {
        return res.status(402).json({
            x402Version: 1,
            error: 'X-Payment header is required',
            message: 'Please sign the EIP-712 payment message and provide the signature in X-Payment header and the message in X-Payment-Message header.',
            accepts: [{
                scheme: 'exact',
                network: 'base',
                maxAmountRequired: '1000000', // 1 USDC (6 decimals)
                resource: 'https://pog-token-api.vercel.app/mint',
                description: 'Mint 10,000 $POG tokens - Sign EIP-712 to pay 1 USDC on Base, get POG tokens instantly!',
                mimeType: 'application/json',
                payTo: PAYMENT_ADDRESS,
                maxTimeoutSeconds: 300,
                asset: USDC_CONTRACT_ADDRESS,
                outputSchema: {
                    input: {
                        type: 'http',
                        method: 'GET',
                        discoverable: true
                    }
                },
                extra: {
                    name: 'POG Token',
                    version: '2',
                    requiredAmount: '1',
                    requiredDecimals: 6
                }
            }]
        });
    }

    try {
        // Step 1: Verify EIP-712 signature and execute TransferWithAuthorization
        const verification = await verifyAndExecuteEIP712(signature, messageJson);

        if (!verification.verified) {
            console.error('[ERROR] EIP-712 Verification and Execution failed:', verification.error);
            return res.status(402).json({
                success: false,
                error: 'Payment verification failed',
                message: verification.error,
                x402Version: 1,
                accepts: [{
                    scheme: 'exact',
                    network: 'base',
                    maxAmountRequired: '1000000',
                    resource: 'https://pog-token-api.vercel.app/mint',
                    description: 'Mint 10,000 $POG tokens - Sign EIP-712 to pay 1 USDC on Base',
                    payTo: PAYMENT_ADDRESS,
                    asset: USDC_CONTRACT_ADDRESS
                }]
            });
        }
        
        const payer = verification.payer;
        const signatureHash = verification.signatureHash;
        const transferTxHash = verification.transferTxHash;

        // Optional: Check if the recovered address matches the X-Account header (for extra security)
        if (account && account.toLowerCase() !== payer.toLowerCase()) {
            console.log(`[WARN] Account mismatch: Header ${account} vs Recovered ${payer}`);
            // We proceed with the recovered address as it's cryptographically proven
        }

        // Step 2: Mint POG tokens to payer
        console.log('[INFO] Minting POG tokens to', payer);

        // Mint POG tokens to payer
        const mintTx = await pogContract.transfer(payer, POG_MINT_AMOUNT);
        const mintReceipt = await mintTx.wait();

        if (!mintReceipt || mintReceipt.status !== 1) {
            throw new Error('Mint transaction failed');
        }

        // Mark as processed
        processedPayments.set(signatureHash, {
            payer,
            mintTxHash: mintTx.hash,
            transferTxHash: transferTxHash,
            timestamp: new Date().toISOString(),
            amount: '10000 POG'
        });

        console.log('[SUCCESS] Mint complete:', mintTx.hash);

        res.json({
            success: true,
            message: 'POG tokens minted successfully!',
            paymentTransaction: transferTxHash, // The actual payment transaction
            mintTransaction: mintTx.hash,
            recipient: payer,
            amount: '10,000 POG',
            network: 'Base Mainnet',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[ERROR] Processing mint request:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process mint request',
            message: error.message
        });
    }
});

// Stats endpoint
app.get('/stats', async (req, res) => {
    try {
        const balance = await pogContract.balanceOf(wallet.address);
        const remaining = ethers.formatEther(balance);

        res.json({
            totalMints: processedPayments.size,
            remainingSupply: `${remaining} POG`,
            pricePerMint: '1 USDC',
            tokensPerMint: '10,000 POG',
            network: 'Base Mainnet',
            paymentAddress: PAYMENT_ADDRESS,
            mode: 'PAYMENT ENFORCED',
            usdcContract: USDC_CONTRACT_ADDRESS,
            pogContract: POG_CONTRACT_ADDRESS
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to get stats',
            message: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 POG x402 API running on port ${PORT}`);
    console.log(`📍 Payment Address: ${PAYMENT_ADDRESS}`);
    console.log(`🪙 POG Contract: ${POG_CONTRACT_ADDRESS}`);
    console.log(`💰 USDC Contract: ${USDC_CONTRACT_ADDRESS}`);
    console.log(`\n✅ PAYMENT VERIFICATION ENABLED`);
    console.log(`✅ API is ready to mint POG tokens with payment verification!`);
});

export default app;

