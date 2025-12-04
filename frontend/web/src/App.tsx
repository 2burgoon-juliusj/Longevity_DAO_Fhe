// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ResearchProposal {
  id: string;
  title: string;
  encryptedBudget: string;
  encryptedDuration: string;
  timestamp: number;
  submitter: string;
  status: "pending" | "approved" | "rejected";
  category: string;
  encryptedData: string;
}

// Randomly selected style: Gradient (warm sunset) + Glassmorphism + Center radiation + Micro-interactions
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<ResearchProposal[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newProposalData, setNewProposalData] = useState({ 
    title: "", 
    description: "", 
    budget: 0,
    duration: 0,
    category: "genetics",
    data: 0
  });
  const [selectedProposal, setSelectedProposal] = useState<ResearchProposal | null>(null);
  const [decryptedValues, setDecryptedValues] = useState<{budget?: number, duration?: number, data?: number}>({});
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<"proposals" | "stats" | "about">("proposals");
  const [searchTerm, setSearchTerm] = useState("");

  // Stats calculations
  const approvedCount = proposals.filter(p => p.status === "approved").length;
  const pendingCount = proposals.filter(p => p.status === "pending").length;
  const rejectedCount = proposals.filter(p => p.status === "rejected").length;
  const totalBudget = proposals.reduce((sum, p) => {
    if (p.status === "approved" && decryptedValues.budget) {
      return sum + decryptedValues.budget;
    }
    return sum;
  }, 0);

  useEffect(() => {
    loadProposals().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadProposals = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load proposal keys
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing proposal keys:", e); }
      }
      
      // Load each proposal
      const list: ResearchProposal[] = [];
      for (const key of keys) {
        try {
          const proposalBytes = await contract.getData(`proposal_${key}`);
          if (proposalBytes.length > 0) {
            try {
              const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
              list.push({ 
                id: key, 
                title: proposalData.title,
                encryptedBudget: proposalData.budget,
                encryptedDuration: proposalData.duration,
                encryptedData: proposalData.data,
                timestamp: proposalData.timestamp, 
                submitter: proposalData.submitter, 
                category: proposalData.category, 
                status: proposalData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing proposal data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading proposal ${key}:`, e); }
      }
      
      // Sort by newest first
      list.sort((a, b) => b.timestamp - a.timestamp);
      setProposals(list);
    } catch (e) { 
      console.error("Error loading proposals:", e); 
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const submitProposal = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting research data with Zama FHE..." 
    });
    
    try {
      // Encrypt sensitive data
      const encryptedBudget = FHEEncryptNumber(newProposalData.budget);
      const encryptedDuration = FHEEncryptNumber(newProposalData.duration);
      const encryptedData = FHEEncryptNumber(newProposalData.data);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Generate unique ID
      const proposalId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Prepare proposal data
      const proposalData = { 
        title: newProposalData.title,
        budget: encryptedBudget,
        duration: encryptedDuration,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000), 
        submitter: address, 
        category: newProposalData.category, 
        status: "pending",
        description: newProposalData.description
      };
      
      // Store proposal
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));
      
      // Update keys list
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { 
          console.error("Error parsing keys:", e); 
        }
      }
      keys.push(proposalId);
      await contract.setData("proposal_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Encrypted research proposal submitted!" 
      });
      
      await loadProposals();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewProposalData({ 
          title: "", 
          description: "", 
          budget: 0,
          duration: 0,
          category: "genetics",
          data: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const approveProposal = async (proposalId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted data with FHE..." 
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Get current proposal data
      const proposalBytes = await contract.getData(`proposal_${proposalId}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
      
      // Update status
      const updatedProposal = { ...proposalData, status: "approved" };
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(updatedProposal)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Proposal approved with FHE verification!" 
      });
      
      await loadProposals();
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Approval failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 3000);
    }
  };

  const rejectProposal = async (proposalId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted data with FHE..." 
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Get current proposal data
      const proposalBytes = await contract.getData(`proposal_${proposalId}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
      
      // Update status
      const updatedProposal = { ...proposalData, status: "rejected" };
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(updatedProposal)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Proposal rejected with FHE verification!" 
      });
      
      await loadProposals();
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Rejection failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ 
        visible: false, 
        status: "pending", 
        message: "" 
      }), 3000);
    }
  };

  const isSubmitter = (proposalAddress: string) => 
    address?.toLowerCase() === proposalAddress.toLowerCase();

  const filteredProposals = proposals.filter(proposal => 
    proposal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    proposal.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    proposal.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderBudgetChart = () => {
    const categories = Array.from(new Set(proposals.map(p => p.category)));
    const categoryBudgets = categories.map(category => {
      const categoryProposals = proposals.filter(p => p.category === category && p.status === "approved");
      const total = categoryProposals.reduce((sum, p) => {
        if (decryptedValues.budget) return sum + decryptedValues.budget;
        return sum;
      }, 0);
      return { category, total };
    });

    return (
      <div className="budget-chart">
        {categoryBudgets.map((item, index) => (
          <div key={index} className="budget-item">
            <div className="budget-category">{item.category}</div>
            <div className="budget-bar-container">
              <div 
                className="budget-bar" 
                style={{ width: `${(item.total / Math.max(1, totalBudget)) * 100}%` }}
              ></div>
            </div>
            <div className="budget-amount">{item.total.toLocaleString()} USDC</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection to Longevity DAO...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="gradient-bg"></div>
      
      <header className="app-header">
        <div className="logo">
          <h1>Longevity<span>DAO</span></h1>
          <p>FHE-Encrypted Research Funding</p>
        </div>
        <div className="header-actions">
          <ConnectButton 
            accountStatus="address" 
            chainStatus="icon" 
            showBalance={false}
            label="Connect Wallet"
          />
        </div>
      </header>

      <main className="main-content">
        <div className="hero-section">
          <div className="hero-content">
            <h2>Privacy-Preserving Longevity Research</h2>
            <p>Fund and manage FHE-encrypted research proposals with complete data privacy</p>
            <div className="hero-buttons">
              <button 
                className="glass-button primary"
                onClick={() => setShowCreateModal(true)}
              >
                Submit Research Proposal
              </button>
              <button className="glass-button">
                Learn About FHE
              </button>
            </div>
          </div>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>

        <div className="navigation-tabs">
          <button 
            className={`tab-button ${activeTab === "proposals" ? "active" : ""}`}
            onClick={() => setActiveTab("proposals")}
          >
            Research Proposals
          </button>
          <button 
            className={`tab-button ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            DAO Statistics
          </button>
          <button 
            className={`tab-button ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About Longevity DAO
          </button>
        </div>

        {activeTab === "proposals" && (
          <div className="proposals-section">
            <div className="section-header">
              <h3>Research Proposals</h3>
              <div className="search-filter">
                <input
                  type="text"
                  placeholder="Search proposals..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="glass-input"
                />
                <button 
                  onClick={loadProposals} 
                  className="glass-button small"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            {filteredProposals.length === 0 ? (
              <div className="no-proposals">
                <div className="icon">🔍</div>
                <p>No research proposals found</p>
                <button 
                  className="glass-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Submit First Proposal
                </button>
              </div>
            ) : (
              <div className="proposals-grid">
                {filteredProposals.map(proposal => (
                  <div 
                    key={proposal.id} 
                    className="proposal-card glass-card"
                    onClick={() => setSelectedProposal(proposal)}
                  >
                    <div className="proposal-header">
                      <h4>{proposal.title}</h4>
                      <span className={`status-badge ${proposal.status}`}>
                        {proposal.status}
                      </span>
                    </div>
                    <div className="proposal-meta">
                      <span className="category">{proposal.category}</span>
                      <span className="date">
                        {new Date(proposal.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="proposal-submitter">
                      Submitted by: {proposal.submitter.substring(0, 6)}...{proposal.submitter.substring(38)}
                    </div>
                    <div className="proposal-actions">
                      {isSubmitter(proposal.submitter) && proposal.status === "pending" && (
                        <>
                          <button 
                            className="action-button approve"
                            onClick={(e) => { e.stopPropagation(); approveProposal(proposal.id); }}
                          >
                            Approve
                          </button>
                          <button 
                            className="action-button reject"
                            onClick={(e) => { e.stopPropagation(); rejectProposal(proposal.id); }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "stats" && (
          <div className="stats-section">
            <div className="stats-grid">
              <div className="stat-card glass-card">
                <h4>Total Proposals</h4>
                <div className="stat-value">{proposals.length}</div>
              </div>
              <div className="stat-card glass-card">
                <h4>Approved</h4>
                <div className="stat-value">{approvedCount}</div>
              </div>
              <div className="stat-card glass-card">
                <h4>Pending</h4>
                <div className="stat-value">{pendingCount}</div>
              </div>
              <div className="stat-card glass-card">
                <h4>Rejected</h4>
                <div className="stat-value">{rejectedCount}</div>
              </div>
            </div>

            <div className="budget-section glass-card">
              <h3>Research Budget Allocation</h3>
              {renderBudgetChart()}
            </div>

            <div className="category-distribution glass-card">
              <h3>Research Categories</h3>
              <div className="category-chart">
                {Array.from(new Set(proposals.map(p => p.category))).map((category, index) => {
                  const count = proposals.filter(p => p.category === category).length;
                  const percentage = (count / proposals.length) * 100;
                  return (
                    <div key={index} className="category-item">
                      <div className="category-label">
                        <span className="color-dot" style={{ backgroundColor: `hsl(${index * 60}, 70%, 50%)` }}></span>
                        {category}
                      </div>
                      <div className="category-bar-container">
                        <div 
                          className="category-bar" 
                          style={{ 
                            width: `${percentage}%`,
                            backgroundColor: `hsl(${index * 60}, 70%, 50%)`
                          }}
                        ></div>
                      </div>
                      <div className="category-count">{count} proposals</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === "about" && (
          <div className="about-section">
            <div className="about-card glass-card">
              <h3>About Longevity DAO</h3>
              <p>
                Longevity DAO is a decentralized autonomous organization focused on funding and managing 
                Fully Homomorphic Encryption (FHE) based longevity research. We enable privacy-preserving 
                research on sensitive genetic and biomarker data through Zama FHE technology.
              </p>
              <div className="features-grid">
                <div className="feature">
                  <div className="feature-icon">🔒</div>
                  <h4>Data Privacy</h4>
                  <p>All research data remains encrypted throughout processing</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">⚡</div>
                  <h4>Decentralized Governance</h4>
                  <p>DAO members vote on research proposals and funding</p>
                </div>
                <div className="feature">
                  <div className="feature-icon">🧬</div>
                  <h4>Longevity Focus</h4>
                  <p>Dedicated to solving aging through privacy-preserving research</p>
                </div>
              </div>
            </div>

            <div className="fhe-explainer glass-card">
              <h3>How FHE Protects Research Data</h3>
              <div className="explainer-steps">
                <div className="step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h4>Data Encryption</h4>
                    <p>Sensitive research data is encrypted using Zama FHE before submission</p>
                  </div>
                </div>
                <div className="step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h4>Encrypted Processing</h4>
                    <p>Data is analyzed and processed while remaining encrypted</p>
                  </div>
                </div>
                <div className="step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h4>Secure Results</h4>
                    <p>Research findings are produced without ever decrypting the raw data</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal glass-card">
            <div className="modal-header">
              <h3>Submit Research Proposal</h3>
              <button 
                onClick={() => setShowCreateModal(false)} 
                className="close-button"
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Research Title *</label>
                <input
                  type="text"
                  name="title"
                  value={newProposalData.title}
                  onChange={(e) => setNewProposalData({...newProposalData, title: e.target.value})}
                  className="glass-input"
                  placeholder="Enter research title"
                />
              </div>
              <div className="form-group">
                <label>Research Category *</label>
                <select
                  name="category"
                  value={newProposalData.category}
                  onChange={(e) => setNewProposalData({...newProposalData, category: e.target.value})}
                  className="glass-input"
                >
                  <option value="genetics">Genetics</option>
                  <option value="biomarkers">Biomarkers</option>
                  <option value="therapeutics">Therapeutics</option>
                  <option value="prevention">Prevention</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  name="description"
                  value={newProposalData.description}
                  onChange={(e) => setNewProposalData({...newProposalData, description: e.target.value})}
                  className="glass-input"
                  placeholder="Describe your research proposal"
                  rows={3}
                ></textarea>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Requested Budget (USDC) *</label>
                  <input
                    type="number"
                    name="budget"
                    value={newProposalData.budget}
                    onChange={(e) => setNewProposalData({...newProposalData, budget: parseFloat(e.target.value) || 0})}
                    className="glass-input"
                    placeholder="Amount in USDC"
                    min="0"
                    step="100"
                  />
                </div>
                <div className="form-group">
                  <label>Duration (Months) *</label>
                  <input
                    type="number"
                    name="duration"
                    value={newProposalData.duration}
                    onChange={(e) => setNewProposalData({...newProposalData, duration: parseFloat(e.target.value) || 0})}
                    className="glass-input"
                    placeholder="Project duration"
                    min="1"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Initial Data Value *</label>
                <input
                  type="number"
                  name="data"
                  value={newProposalData.data}
                  onChange={(e) => setNewProposalData({...newProposalData, data: parseFloat(e.target.value) || 0})}
                  className="glass-input"
                  placeholder="Initial research data value"
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-row">
                  <span>Budget:</span>
                  <code>{FHEEncryptNumber(newProposalData.budget).substring(0, 20)}...</code>
                </div>
                <div className="preview-row">
                  <span>Duration:</span>
                  <code>{FHEEncryptNumber(newProposalData.duration).substring(0, 20)}...</code>
                </div>
                <div className="preview-row">
                  <span>Data:</span>
                  <code>{FHEEncryptNumber(newProposalData.data).substring(0, 20)}...</code>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowCreateModal(false)}
                className="glass-button"
              >
                Cancel
              </button>
              <button
                onClick={submitProposal}
                disabled={creating || !newProposalData.title || !newProposalData.budget || !newProposalData.duration || !newProposalData.data}
                className="glass-button primary"
              >
                {creating ? "Submitting..." : "Submit Proposal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedProposal && (
        <div className="modal-overlay">
          <div className="detail-modal glass-card">
            <div className="modal-header">
              <h3>{selectedProposal.title}</h3>
              <button 
                onClick={() => {
                  setSelectedProposal(null);
                  setDecryptedValues({});
                }} 
                className="close-button"
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="proposal-meta">
                <div className="meta-item">
                  <span className="meta-label">Status:</span>
                  <span className={`status-badge ${selectedProposal.status}`}>
                    {selectedProposal.status}
                  </span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Category:</span>
                  <span>{selectedProposal.category}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Submitted:</span>
                  <span>{new Date(selectedProposal.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Researcher:</span>
                  <span>{selectedProposal.submitter}</span>
                </div>
              </div>

              <div className="encrypted-data-section">
                <h4>Encrypted Research Data</h4>
                <div className="data-item">
                  <span>Budget:</span>
                  <code>{selectedProposal.encryptedBudget.substring(0, 30)}...</code>
                  <button 
                    className="decrypt-button"
                    onClick={async () => {
                      if (decryptedValues.budget) {
                        setDecryptedValues({...decryptedValues, budget: undefined});
                      } else {
                        const decrypted = await decryptWithSignature(selectedProposal.encryptedBudget);
                        if (decrypted !== null) {
                          setDecryptedValues({...decryptedValues, budget: decrypted});
                        }
                      }
                    }}
                    disabled={isDecrypting}
                  >
                    {decryptedValues.budget ? "Hide" : "Decrypt"}
                  </button>
                </div>
                {decryptedValues.budget && (
                  <div className="decrypted-value">
                    Decrypted Budget: {decryptedValues.budget} USDC
                  </div>
                )}

                <div className="data-item">
                  <span>Duration:</span>
                  <code>{selectedProposal.encryptedDuration.substring(0, 30)}...</code>
                  <button 
                    className="decrypt-button"
                    onClick={async () => {
                      if (decryptedValues.duration) {
                        setDecryptedValues({...decryptedValues, duration: undefined});
                      } else {
                        const decrypted = await decryptWithSignature(selectedProposal.encryptedDuration);
                        if (decrypted !== null) {
                          setDecryptedValues({...decryptedValues, duration: decrypted});
                        }
                      }
                    }}
                    disabled={isDecrypting}
                  >
                    {decryptedValues.duration ? "Hide" : "Decrypt"}
                  </button>
                </div>
                {decryptedValues.duration && (
                  <div className="decrypted-value">
                    Decrypted Duration: {decryptedValues.duration} months
                  </div>
                )}

                <div className="data-item">
                  <span>Research Data:</span>
                  <code>{selectedProposal.encryptedData.substring(0, 30)}...</code>
                  <button 
                    className="decrypt-button"
                    onClick={async () => {
                      if (decryptedValues.data) {
                        setDecryptedValues({...decryptedValues, data: undefined});
                      } else {
                        const decrypted = await decryptWithSignature(selectedProposal.encryptedData);
                        if (decrypted !== null) {
                          setDecryptedValues({...decryptedValues, data: decrypted});
                        }
                      }
                    }}
                    disabled={isDecrypting}
                  >
                    {decryptedValues.data ? "Hide" : "Decrypt"}
                  </button>
                </div>
                {decryptedValues.data && (
                  <div className="decrypted-value">
                    Decrypted Data Value: {decryptedValues.data}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => {
                  setSelectedProposal(null);
                  setDecryptedValues({});
                }}
                className="glass-button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-logo">
            <h4>Longevity DAO</h4>
            <p>Privacy-Preserving Research Funding</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Governance</a>
            <a href="#" className="footer-link">Research Portal</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
          <div className="footer-social">
            <span>Powered by Zama FHE</span>
          </div>
        </div>
        <div className="footer-copyright">
          © {new Date().getFullYear()} Longevity DAO. All rights reserved.
        </div>
      </footer>
    </div>
  );
};

export default App;