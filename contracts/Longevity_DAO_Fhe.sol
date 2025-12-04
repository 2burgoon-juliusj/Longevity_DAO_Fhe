pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LongevityDAOFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public isBatchClosed;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PauseToggled(bool indexed isPaused);
    event CooldownSecondsUpdated(uint256 indexed newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, bytes32 indexed encryptedData);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 decryptedResult);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrInvalid();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60; // Default 60 seconds cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsUpdated(newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        isBatchClosed[currentBatchId] = false;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        if (batchId == 0 || batchId > currentBatchId || isBatchClosed[batchId]) revert InvalidBatchId();
        isBatchClosed[batchId] = true;
        emit BatchClosed(batchId);
    }

    function submitEncryptedData(euint32 encryptedData) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (currentBatchId == 0 || isBatchClosed[currentBatchId]) {
            revert BatchClosedOrInvalid();
        }

        lastSubmissionTime[msg.sender] = block.timestamp;

        // For this example, we'll just store the ciphertext.
        // A real contract would manage a list of submissions per batch.
        // The actual storage and aggregation logic would be more complex.
        // Here, we emit the data and assume it's part of the current batch.
        emit DataSubmitted(msg.sender, currentBatchId, encryptedData.toBytes32());
    }

    function requestAggregateDecryption(uint256 batchId) external onlyProvider whenNotPaused {
        if (batchId == 0 || batchId > currentBatchId || !isBatchClosed[batchId]) {
            revert InvalidBatchId();
        }
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }

        // In a real scenario, this would fetch all encrypted data for the batch
        // and perform FHE operations (e.g., sum, average).
        // For this example, we'll simulate by creating a dummy euint32.
        // The actual aggregation logic is the core FHE computation.
        // For instance, if we had a list of euint32 `batchData`:
        // euint32 sum = FHE.asEuint32(0);
        // for (uint i = 0; i < batchData.length; i++) {
        //     sum = FHE.add(sum, batchData[i]);
        // }
        // Then `sum` would be the ciphertext to decrypt.

        euint32 dummyAggregatedValue = FHE.asEuint32(0); // Placeholder for actual FHE aggregation
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = dummyAggregatedValue.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // Replay Guard
        if (decryptionContexts[requestId].processed) {
            revert ReplayAttempt();
        }

        // State Verification
        // In a real contract, this would reconstruct the ciphertexts array
        // that was used for the original requestDecryption call.
        // For this example, we assume a single dummy value was encrypted.
        // The actual ciphertexts would be fetched from storage based on decryptionContexts[requestId].batchId.
        // e.g., by iterating over stored encrypted submissions for that batch.
        euint32 dummyCt = FHE.asEuint32(0); // Placeholder - should be actual ciphertext from storage
        bytes32[] memory currentCts = new bytes32[](1);
        currentCts[0] = dummyCt.toBytes32();

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        // Proof Verification
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode & Finalize
        // The cleartexts are expected in the same order as `cts` in requestDecryption.
        // Here, we expect one uint256.
        uint256 decryptedValue = abi.decode(cleartexts, (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, decryptedValue);
        // Further logic using decryptedValue would go here
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    // Placeholder for FHE initialization if needed by specific FHE schemes
    // (e.g., some schemes might require an explicit setup phase for keys/params)
    // For Zama's FHEVM, this is often handled by the FHE library itself.
    // If specific contract-level initialization is needed:
    // function _initIfNeeded() internal {
    //     if (!FHE.isInitialized()) {
    //         // Perform one-time FHE setup if necessary
    //         // e.g., FHE.initialize(someParams);
    //     }
    // }

    // Placeholder for a requireInitialized modifier if needed
    // modifier requireInitialized() {
    //     if (!FHE.isInitialized()) revert FHENotInitialized();
    //     _;
    // }
    // error FHENotInitialized();
}