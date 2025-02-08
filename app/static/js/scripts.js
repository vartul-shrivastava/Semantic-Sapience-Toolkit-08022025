const modalBackdrop = document.getElementById('modalBackdrop');
const systemTrayLinks = document.getElementById('systemTrayLinks');
const statsCardsWrapper = document.getElementById('statsCardsWrapper');

let currentFile = null;        // The file object uploaded by the user
let currentFileBase64 = null;  // Base64 representation of that file’s contents
let currentFileName = null;    // Keep track of the file name
let datasetColumns = [];       // Store header names from CSV/XLSX
let allModals = {};            // Store all modals (open and minimized) with their checkpoints

let currentDatasetStats = null; // Store the current dataset statistics

const MODAL_TEMPLATES = {
    tfidf: 'tfidfModal',
    freq: 'freqModal',
    collocation: 'collocationModal',
    lda: 'ldaModal',
    nmf: 'nmfModal',
    bertopic: 'bertopicModal',
    lsa: 'lsaModal',
    llmbased: 'llmbasedModal',
    rulebasedsa: 'rulebasedsaModal',
    dlbasedsa: 'dlbasedsaModal',
    zeroshotSentiment: 'zeroshotSentimentModal',
    absa: 'absaModal',
    semanticwc: 'semanticwcModal',
};

/* ============ MODEL DISPLAY NAMES DICTIONARY ============ */
const modelDisplayNames = {
    tfidf: 'Term Frequency-Inverse Document Frequency (TF-IDF)',
    freq: 'Frequency Analysis',
    collocation: 'Collocation Analysis',
    lda: 'Latent Dirichlet Allocation (LDA)',
    nmf: 'Non-negative Matrix Factorization (NMF)',
    bertopic: 'BERTopic',
    lsa: 'Latent Semantic Analysis (LSA)',
    llmbased: 'LLM-Based Sentiment Analysis',
    rulebasedsa: 'Rule-Based Sentiment Analysis',
    dlbasedsa: 'Deep Learning-Based Sentiment Analysis',
    absa: 'Aspect-Based Sentiment Analysis (ABSA)',
    zeroshotSentiment: 'Zero-Shot Sentiment Analysis',
    topicspecificwc: 'Topic-Specific Word Cloud',
    semanticwc: 'Semantic Word Cloud'
};


if (systemTrayLinks) {
    systemTrayLinks.innerHTML = ''; // Clear the HTML content
}


document.addEventListener('DOMContentLoaded', () => {
    initializeSystemStats();
    const largeDisplay = document.querySelector('.large-display');
    const defaultContent = document.getElementById('defaultContent');
  
    // Function to update the visibility of default content
    const updateDefaultContentVisibility = () => {
      // Check if there are any modals currently in the large-display
      const activeModals = largeDisplay.querySelectorAll('.modal');
      
      if (activeModals.length > 0) {
        // Hide default content if any modal is present
        defaultContent.style.display = 'none';
      } else {
        // Show default content if no modals are present
        defaultContent.style.display = 'flex';
      }
    };
  
    // Initialize MutationObserver to watch for changes in large-display
    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          updateDefaultContentVisibility();
        }
      }
    });
  
    // Configuration of the observer:
    const config = { childList: true, subtree: true };
  
    // Start observing the target node for configured mutations
    observer.observe(largeDisplay, config);
  
    // Initial check on page load
    updateDefaultContentVisibility();
  });


/**
 * Attach an event listener to a modal so that when the "coherence_analysis"
 * checkbox is toggled, the corresponding coherence parameters div is shown or hidden.
 * This function assumes that the coherence parameters container has an id ending in "-coherence-params".
 * @param {HTMLElement} modal - The cloned modal element.
 */
function attachCoherenceListener(modal) {
    // Look for a checkbox with name "coherence_analysis"
    const coherenceCheckbox = modal.querySelector('input[name="coherence_analysis"]');
    if (!coherenceCheckbox) return; // nothing to do if not present

    // Look for a container whose id ends with "coherence-params"
    const coherenceParamsDiv = modal.querySelector('div[id$="coherence-params"]');
    if (!coherenceParamsDiv) return;

    // Set initial display based on the checkbox state
    coherenceParamsDiv.style.display = coherenceCheckbox.checked ? 'block' : 'none';

    // Attach the event listener to toggle the display
    coherenceCheckbox.addEventListener('change', () => {
      coherenceParamsDiv.style.display = coherenceCheckbox.checked ? 'block' : 'none';
    });
}

  

function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

/**
 * Convert a File object to a Base64 string.
 * @param {File} file - The file to convert.
 * @returns {Promise<string>} - A promise that resolves to the Base64 string.
 */
async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

/**
 * Trigger the hidden file input for uploading CSV/XLSX files.
 */
function triggerFileUpload() {
    const fileInput = document.getElementById('fileInput');
    fileInput.value = "";
    fileInput.click();
}

/**
 * Trigger the hidden file input for importing project files (.ssproj).
 */
function triggerProjectImport() {   
    const importInput = document.getElementById('importLspInput');
    importInput.value = "";
    importInput.click();
}

/* ============ FILE UPLOAD HANDLING ============ */
document.getElementById('fileInput').addEventListener('change', handleFileUpload);

/**
 * Handle file uploads (CSV/XLSX).
 * @param {Event} event - The file input change event.
 */
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoading();
    try {
        currentFile = file;
        currentFileName = file.name;
        currentFileBase64 = await fileToBase64(file);

        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/upload", {
            method: "POST",
            body: formData
        });

        const data = await response.json();
        if (!response.ok) {
            alert(data.error || "Error uploading file.");
            datasetColumns = [];
            currentDatasetStats = null;
            renderStats([]);
            return;
        }

        if (data.stats) {
            datasetColumns = Object.keys(data.stats);
            currentDatasetStats = data.stats; // Store the stats
            renderStatsFromServerStats(data.stats);
        } else {
            alert(data.message || "No stats returned from server.");
            datasetColumns = [];
            currentDatasetStats = null;
            renderStats([]);
        }
    } catch (error) {
        console.error(error);
        alert("Error processing file: " + error.message);
        datasetColumns = [];
        currentDatasetStats = null;
        renderStats([]);
    } finally {
        hideLoading();
    }
}

document.getElementById('importLspInput').addEventListener('change', handleProjectImport);

/**
 * Handle importing a project from a .ssproj file.
 * @param {Event} event - The file input change event.
 */
async function handleProjectImport(evt) {
    const file = evt.target.files[0];
    if (!file) return;
  
    // Read file as ArrayBuffer
    const reader = new FileReader();
    reader.onload = async (e) => {
      const fileBuffer = e.target.result;
      const iv = new Uint8Array(fileBuffer.slice(0, 12)); // First 12 bytes = IV
      const encryptedData = new Uint8Array(fileBuffer.slice(12));
  
      // 1) Try with existing sessionKey
      try {
        if (!sessionKey) throw new Error("No sessionKey set yet.");
        const decryptedData = await decryptData(encryptedData, iv);
        const projectData = JSON.parse(decryptedData);
        await setProjectConfig(projectData);
        console.log("Project imported successfully with existing sessionKey.");
        return; // Done if successful
      } catch (error) {
        console.warn("Initial decryption failed:", error);
      }
  
      // 2) If that fails, show overlay for new password
      let newPassword;
      try {
        newPassword = await requestDecryptionPassword();
      } catch (cancelError) {
        // User canceled the overlay
        console.log(cancelError);
        return; // Abort
      }
  
      // 3) Generate a new key from that password
      let newKey;
      try {
        newKey = await generateKeyFromPassword(newPassword);
      } catch (error) {
        console.error("Failed to generate new key:", error);
        // You might show a small error message overlay as well
        return;
      }
  
      // 4) Retry with new key
      try {
        const decryptedData = await decryptData(encryptedData, iv, newKey);
        const projectData = JSON.parse(decryptedData);
        // Optionally store newKey as the global sessionKey so subsequent actions use the correct password
        sessionKey = newKey;
        await setProjectConfig(projectData);
        console.log("Project imported successfully after re-entering password.");
      } catch (error2) {
        console.error("Second decryption attempt failed:", error2);
        // Optionally allow multiple attempts or show an error overlay
      }
    };
  
    reader.readAsArrayBuffer(file);
  }


function requestDecryptionPassword() {
    return new Promise((resolve, reject) => {
      const overlay = document.getElementById('decryptionOverlay');
      const passwordInput = document.getElementById('overlayPasswordInput');
      const confirmBtn = document.getElementById('overlayConfirmBtn');
      const cancelBtn = document.getElementById('overlayCancelBtn');
  
      // Clear any previous input
      passwordInput.value = '';
  
      // Show the overlay
      overlay.style.display = 'flex'; // or block, depending on your CSS
  
      // Confirm logic
      const onConfirm = () => {
        const pass = passwordInput.value.trim();
        // Optionally validate pass is non-empty
        if (!pass) {
          // Provide some inline message or shake effect, etc.
          return;
        }
        hideOverlay();
        resolve(pass);
      };
  
      // Cancel logic
      const onCancel = () => {
        hideOverlay();
        reject(new Error('User canceled password entry.'));
      };
  
      // Helper to hide overlay and remove event listeners
      const hideOverlay = () => {
        overlay.style.display = 'none';
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
      };
  
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
    });
  }
  
  

/* ============ DATASET STATS RENDERING ============ */

/**
 * Render dataset statistics received from the server or imported config.
 * @param {Object} statsObj - The statistics object.
 */
function renderStatsFromServerStats(statsObj) {
    const statsArr = Object.entries(statsObj).map(([colName, info]) => {
        if (info.type === 'Numeric') {
            return {
                colName,
                type: 'Numeric',
                mean: info.mean.toFixed(2),
                stdDev: info.stdDev.toFixed(2)
            };
        } else {
            return {
                colName,
                type: 'Textual',
                avgLen: info.avgLen.toFixed(2),
                maxLen: info.maxLen,
                minLen: info.minLen,
                uniqueCount: info.uniqueCount
            };
        }
    });
    renderStats(statsArr);
}

/**
 * Render the statistics cards in the dashboard.
 * @param {Array<Object>} statsArr - Array of statistics objects.
 */
function renderStats(statsArr) {
    statsCardsWrapper.innerHTML = "";
    if (!statsArr || statsArr.length === 0) {
        statsCardsWrapper.textContent = "No data to display.";
        statsCardsWrapper.style.color = "#004aad";
        return;
    }

    statsArr.forEach(stat => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        if (stat.type === 'Numeric') {
            card.innerHTML = `
                <h3>${stat.colName}</h3>
                <p>Type: Numeric</p>
                <p>Mean: ${stat.mean}</p>
                <p>Std Dev: ${stat.stdDev}</p>
            `;
        } else {
            card.innerHTML = `
                <h3>${stat.colName}</h3>
                <p>Type: Textual</p>
                <p>Avg Length: ${stat.avgLen}</p>
                <p>Max Length: ${stat.maxLen}</p>
                <p>Min Length: ${stat.minLen}</p>
                <p>Unique Values: ${stat.uniqueCount}</p>
            `;
        }
        statsCardsWrapper.appendChild(card);
    });
}

/* ============ PROJECT IMPORT/EXPORT HANDLING ============ */

/**
 * Export the current project configuration as a .ssproj file.
 */
async function exportProject() {
    if (!sessionKey) {
      console.error("Session key is not set."); // Debugging
      alert("Session password not set. Please reload the page and set a password.");
      return;
    }
    console.log("Exporting project with session key:", sessionKey); // Debugging
  
    const projectData = await collectProjectConfig(); // Your function to collect project data
    const { encryptedData, iv } = await encryptData(JSON.stringify(projectData));
    const blob = new Blob([iv, encryptedData], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const timestamp = Date.now();
    a.download = `project-${(new Date(timestamp).toLocaleString())}.ssproj`;
    a.click();
  }

  // Event listener for the "Check AI Dependency" button
  checkAIDependencyBtn.addEventListener('click', () => {
    showLoading(); // Show loading overlay

    fetch('/check_ai_readiness', {  // Updated URL
      method: 'GET',  // Changed to GET as per route definition
      headers: {
        'Content-Type': 'application/json'
      },
      // No body needed for GET request
    })
      .then(response => response.json())
      .then(data => {
        hideLoading(); // Hide loading overlay
        if (data.success !== undefined) {  // Adjust based on response structure
          if (!data.ollama_ready) {
            alert(`Error: ${data.error}`);
            return;
          }
          displayAIModules(data.models, data.ollama_ready, data.error);
        } else {
          // If 'success' key is not used in /check_ai_readiness, adjust accordingly
          displayAIModules(data.models, data.ollama_ready, data.error);
        }
      })
      .catch(error => {
        hideLoading(); // Hide loading overlay
        console.error('Error fetching AI dependencies:', error);
        alert('An error occurred while checking AI dependencies.');
      });
  });


  // Function to display AI models
  function displayAIModules(models, ollamaReady, error) {
    if (!ollamaReady) {
      alert(`Error: ${error}`);
      return;
    }

    if (!models || models.length === 0) {
      alert("No Ollama AI models are currently installed.");
      return;
    }

    // Create a formatted string of models
    const modelList = models.join("\n");

    // Display the models in an alert or a better UI component
    alert(`Installed Ollama AI Models:\n\n${modelList}`);
  }
/**
 * Collect and compile the current project configuration.
 * @returns {Object} - The project configuration.
 */
async function collectProjectConfig() {
    const modalsData = [];
    const openModals = modalBackdrop.querySelectorAll('.modal');
    openModals.forEach(modalEl => {
        const modalId = modalEl.dataset.modalId;
        const methodId = modalEl.dataset.methodName;
        const state = modalEl.classList.contains('maximized') ? 'maximized' : 'open';
        const fields = getModalFields(modalEl);
        const previewSection = modalEl.querySelector('.preview-section');
        const previewContent = previewSection ? previewSection.innerHTML : '';

        // Retrieve checkpoints from allModals
        let checkpoints = [];
        if (allModals[modalId] && allModals[modalId].checkpoints) {
            checkpoints = allModals[modalId].checkpoints;
        }

        modalsData.push({
            modalId,
            methodId,
            state,
            fields,
            previewContent,
            checkpoints // Include checkpoints
        });
    });

    // Include minimized modals from the system tray
    for (const modalId in allModals) {
        const entry = allModals[modalId];
        if (entry.state === 'minimized') {
            modalsData.push({
                modalId,
                methodId: entry.methodId,
                state: 'minimized',
                fields: entry.fields,
                previewContent: entry.previewContent,
                checkpoints: entry.checkpoints || []
            });
        }
    }

    const dataset = {
        fileName: currentFileName || null,
        base64: currentFileBase64 || null,
        stats: currentDatasetStats || null // Include dataset stats
    };

    return {
        dataset,
        modals: modalsData
    };
}

/**
 * Set the project configuration from an imported .ssproj file.
 * @param {Object} config - The project configuration object.
 */
async function setProjectConfig(config) {
    closeAllModals(); // Close any existing modals before importing

    // Ensure allModals is reset
    allModals = {};

    if (config.dataset) {
        // Restore dataset information
        currentFileName = config.dataset.fileName;
        currentFileBase64 = config.dataset.base64;
        currentDatasetStats = config.dataset.stats;

        if (currentDatasetStats) {
            datasetColumns = Object.keys(currentDatasetStats);
            renderStatsFromServerStats(currentDatasetStats);
        } else {
            datasetColumns = [];
            renderStats([]);
        }
    }

    if (config.modals && Array.isArray(config.modals)) {
        for (const modalConfig of config.modals) {
            const { modalId, methodId, state, fields, previewContent, checkpoints } = modalConfig;
            const newModal = openModal(methodId, modalId); // Open modal with existing modalId
            if (!newModal) continue; // Skip if modal template not found

            // Restore form fields
            setModalFields(newModal, fields);

            // Restore preview section content
            const previewSection = newModal.querySelector('.preview-section');
            if (previewSection && previewContent) {
                previewSection.innerHTML = previewContent;
            }

            // Initialize or update the modal's entry in allModals
            if (!allModals[modalId]) {
                allModals[modalId] = {
                    methodId: methodId,
                    chosenCol: fields.textColumn || '',
                    fields: fields,
                    previewContent: previewContent,
                    state: state,
                    checkpoints: [],
                    trayLink: null
                };
            } else {
                allModals[modalId].fields = fields;
                allModals[modalId].previewContent = previewContent;
                allModals[modalId].state = state;
            }

            // Restore modal state (minimized or maximized)
            if (state === 'minimized') {
                // Use force=true to bypass duplication check
                minimizeModal(newModal, methodId, true);
            } else if (state === 'maximized') {
                toggleMaximizeModal(newModal);
            }

            // Restore checkpoints
            if (checkpoints && Array.isArray(checkpoints)) {
                checkpoints.forEach(checkpoint => {
                    // Add checkpoint to allModals
                    if (!allModals[modalId].checkpoints) {
                        allModals[modalId].checkpoints = [];
                    }
                    allModals[modalId].checkpoints.push(checkpoint);

                    // Add checkpoint item to the modal's checkpoint tray
                    addCheckpointToModal(newModal, checkpoint);
                });
            }
        }
    }
}

function closeAllModals() {
    const openModals = modalBackdrop.querySelectorAll('.modal');
    openModals.forEach(modal => closeModal(modal));
}

/* ============ CHECKPOINT FUNCTIONS ============ */

/**
 * Create a checkpoint with current config and output data.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {Object} config - The configuration used for analysis.
 * @param {string} outputData - The generated output data (e.g., image URLs, analysis results).
 */
function createCheckpoint(modalEl, config, outputData) {
    const modalId = modalEl.dataset.modalId;
    const timestamp = Date.now();
    const checkpointId = `${modalId}-checkpoint-${timestamp}`;
    
    const checkpoint = {
        id: checkpointId,
        timestamp: timestamp,
        config: config,
        outputData: outputData // Store the actual output data
    };
    
    // Initialize modal entry in allModals if not present
    if (!allModals[modalId]) {
        allModals[modalId] = {
            methodId: config.methodId,
            chosenCol: config.fields.textColumn || '',
            fields: config.fields,
            previewContent: outputData,
            state: modalEl.classList.contains('minimized') ? 'minimized' : (modalEl.classList.contains('maximized') ? 'maximized' : 'open'),
            checkpoints: []
        };
    }
    
    allModals[modalId].checkpoints.push(checkpoint);
    
    // Update the checkpoint tray in the modal
    addCheckpointToModal(modalEl, checkpoint);
}

/**
 * Add a checkpoint item to the modal's checkpoint tray.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {Object} checkpoint - The checkpoint object.
 */
function addCheckpointToModal(modalEl, checkpoint) {
    const checkpointTray = modalEl.querySelector('.checkpoints-list');
    if (!checkpointTray) return;
    
    const checkpointItem = document.createElement('div');
    checkpointItem.className = 'checkpoint-item';
    checkpointItem.textContent = `MHC-${new Date(checkpoint.timestamp).toLocaleString()}`;
    checkpointItem.title = "Click to restore this checkpoint";
    
    // Attach onclick handler to restore the checkpoint
    checkpointItem.onclick = () => restoreCheckpoint(modalEl, checkpoint.id);
    
    checkpointTray.appendChild(checkpointItem);
}

async function loadModels() {
    try {
      const response = await fetch("/get_models");
      const data = await response.json();
      if (data.success) {
        const modelSelects = document.querySelectorAll("#modelSelect"); // Select all dropdowns with the class "modelSelect"
        modelSelects.forEach(modelSelect => {
          modelSelect.innerHTML = ""; // Clear existing options
          data.models.forEach(modelName => {
            const option = document.createElement("option");
            option.value = modelName;
            option.textContent = modelName;
            modelSelect.appendChild(option);
          });
        });
      } else {
        console.error("Error fetching models:", data.error);
      }
    } catch (error) {
      console.error("Error fetching models:", error);
    }
  }
  
  window.addEventListener("DOMContentLoaded", loadModels);
  
  

/**
 * Restore a modal's state from a specific checkpoint.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} checkpointId - The unique identifier for the checkpoint.
 */
function restoreCheckpoint(modalEl, checkpointId) {
    const modalId = modalEl.dataset.modalId;
    const checkpoint = allModals[modalId]?.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
        alert("Checkpoint not found.");
        return;
    }
    
    const { config, outputData } = checkpoint;
    if (!config || !config.fields) {
        alert("Invalid checkpoint configuration.");
        return;
    }
    
    // Restore form fields
    setModalFields(modalEl, config.fields);
    
    // Restore preview data
    const previewSection = modalEl.querySelector('.preview-section');
    if (previewSection && outputData) {
        previewSection.innerHTML = outputData;
    }
    
    // Update modal state if needed
    if (modalEl.classList.contains('minimized')) {
        // Optionally, you can toggle to open state
        // toggleMinimizeModal(modalEl);
    }
    
}


/* ============ FORM DATA HANDLING ============ */

/**
 * Retrieve form data from a modal.
 * @param {HTMLElement} modalEl - The modal element.
 * @returns {Object} - The form data.
 */
function getModalFields(modalEl) {
    const fields = {};
    const inputs = modalEl.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        if (!input.name) return;
        if (input.type === 'checkbox') {
            fields[input.name] = input.checked;
        } else {
            fields[input.name] = input.value.trim();
        }
    });
    return fields;
}

/**
 * Set form data in a modal.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {Object} data - The form data to set.
 */
function setModalFields(modalEl, data) {
    if (!data) return;
    const inputs = modalEl.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        if (!input.name || !data.hasOwnProperty(input.name)) return;
        if (input.type === 'checkbox') {
            input.checked = data[input.name];
        } else {
            input.value = data[input.name];
        }
    });
}

/* ============ MODAL MANAGEMENT FUNCTIONS ============ */

/**
 * Invoke a method by opening the corresponding modal.
 * @param {string} methodId - The identifier for the method.
 */
function invokeMethod(methodId) {
    if (datasetColumns.length === 0) {
        alert("Please upload a CSV/XLSX dataset before opening a modal.");
        return;
    }
    openModal(methodId);
}
let zIndexCounter = 10;
/**
 * Open a modal based on the method ID.
 * @param {string} methodId - The identifier for the method.
 * @param {string|null} existingModalId - The existing modal ID if restoring.
 * @returns {HTMLElement|null} - The newly opened modal element.
 */

function openModal(methodId, existingModalId = null) {
    const templateId = MODAL_TEMPLATES[methodId];
    if (!templateId) {
        console.warn(`No modal template found for method ID: ${methodId}`);
        return null;
    }

    const templateEl = document.getElementById(templateId);
    if (!templateEl) {
        console.warn(`Modal template element not found: ${templateId}`);
        return null;
    }

    // Clone the modal from the template
    const clonedModal = templateEl.querySelector('.modal').cloneNode(true);
    const uniqueId = existingModalId || `${methodId}-${Date.now()}`;
    clonedModal.dataset.modalId = uniqueId;
    clonedModal.dataset.methodName = methodId;

    // Populate the text column select options
    const textColumnSelect = clonedModal.querySelector('select[name="textColumn"]');
    if (textColumnSelect) {
        textColumnSelect.innerHTML = '';
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = '--- Select Column ---';
        textColumnSelect.appendChild(placeholderOption);
        datasetColumns.forEach(col => {
            const option = document.createElement('option');
            option.value = col;
            option.textContent = col;
            textColumnSelect.appendChild(option);
        });
        if (existingModalId && allModals[existingModalId]?.chosenCol) {
            textColumnSelect.value = allModals[existingModalId].chosenCol;
        }
    }

    // Attach the coherence analysis listener
    attachCoherenceListener(clonedModal);

    // Append the modal to the backdrop and initialize other functionalities
    modalBackdrop.appendChild(clonedModal);
    modalBackdrop.style.display = 'flex';
    initializeModalInteractions(clonedModal);
    randomizeModalPosition(clonedModal);

    // Attach event listeners to control buttons (close, minimize, maximize)
    const closeButton = clonedModal.querySelector('.close-btn');
    const minimizeButton = clonedModal.querySelector('.minimize-btn');
    const maximizeButton = clonedModal.querySelector('.maximize-btn');

    closeButton.onclick = () => closeModal(clonedModal);
    minimizeButton.onclick = () => minimizeModal(clonedModal, methodId);
    maximizeButton.onclick = () => toggleMaximizeModal(clonedModal);

    attachModalEventListeners(clonedModal, methodId);
    clonedModal.style.zIndex = zIndexCounter++;

    // (Restore checkpoints etc., if needed)
    return clonedModal;
}


/**
 * Attach event listeners to modal buttons based on method type.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} methodId - The method identifier.
 */
function attachModalEventListeners(modalEl, methodId) {
    const runButton = modalEl.querySelector('.modal-footer .btn.run-btn');
    const downloadButton = modalEl.querySelector('.modal-footer .btn.download-btn');
    
    if (runButton && downloadButton) {
        switch (methodId) {
            case 'tfidf':
            case 'freq':
            case 'collocation':
                runButton.addEventListener('click', () => regenerateWordCloud(modalEl, methodId));
                downloadButton.addEventListener('click', () => downloadWordCloud(modalEl, methodId));
                break;
            case 'semanticwc':
                runButton.addEventListener('click', () => generateSemanticWordCloud(modalEl));
                downloadButton.addEventListener('click', () => downloadWordCloud(modalEl, methodId));
                break;
            case 'lda':
            case 'nmf':
            case 'bertopic':
            case 'lsa':
                runButton.addEventListener('click', () => runTopicModeling(modalEl, methodId));
                downloadButton.addEventListener('click', () => downloadTopicModelingResults(modalEl, methodId));
                break;
            case 'rulebasedsa':
            case 'dlbasedsa':
            case 'absa':
            case 'zeroshotSentiment':
                runButton.addEventListener('click', () => runSentimentAnalysis(modalEl, methodId));
                downloadButton.addEventListener('click', () => downloadSentimentAnalysisResults(modalEl, methodId));
                break;
            default:
                console.warn(`No run/download handlers defined for method ID: ${methodId}`);
        }
    }
}



/**
 * Position a modal at a random location within the modal backdrop.
 * @param {HTMLElement} modalEl - The modal element to position.
 */
function randomizeModalPosition(modalEl) {
    const backdropRect = modalBackdrop.getBoundingClientRect();
    const modalRect = modalEl.getBoundingClientRect();

    // Calculate the maximum allowed left and top positions
    const maxLeft = backdropRect.width - modalRect.width;
    const maxTop = backdropRect.height - modalRect.height;

    // Generate random left and top positions within the allowed range
    const randomLeft = Math.floor(Math.random() * (maxLeft > 0 ? maxLeft : 0));
    const randomTop = Math.floor(Math.random() * (maxTop > 0 ? maxTop : 0));

    // Apply the random positions
    modalEl.style.left = `${randomLeft}px`;
    modalEl.style.top = `${randomTop}px`;
}


document.addEventListener("DOMContentLoaded", () => {
    const contextMenu = document.getElementById("contextMenu");
    const largeDisplay = document.querySelector(".large-display");
  
    // Show the context menu
    document.addEventListener("contextmenu", (event) => {
      event.preventDefault();
  
      const { clientX: mouseX, clientY: mouseY } = event;
  
      // Position the context menu
      contextMenu.style.top = `${mouseY}px`;
      contextMenu.style.left = `${mouseX}px`;
      contextMenu.style.display = "block";
    });
  
    // Hide the context menu when clicking elsewhere
    document.addEventListener("click", () => {
      contextMenu.style.display = "none";
    });
  });
  


document.addEventListener('DOMContentLoaded', () => {
    const largeDisplay = document.querySelector('.large-display');
    const toggleButton = document.querySelector('.toggle-fullscreen-btn');
    let isFullscreen = false;
    let originalStyles = {};

    toggleButton.addEventListener('click', () => {
        if (!isFullscreen) {
            // Store the original styles
            originalStyles = {
                width: largeDisplay.style.width,
                height: largeDisplay.style.height,
                left: largeDisplay.style.left,
                top: largeDisplay.style.top,
                position: largeDisplay.style.position,
                zIndex: largeDisplay.style.zIndex,
            };

            // Make the modal fullscreen
            largeDisplay.style.position = 'fixed';
            largeDisplay.style.left = '0';
            largeDisplay.style.top = '0';
            largeDisplay.style.width = '100%';
            largeDisplay.style.height = '100%';
            largeDisplay.style.zIndex = '3000'; // Bring it above all other elements

            isFullscreen = true;
            toggleButton.textContent = 'Exit Fullscreen';
        } else {
            // Restore the original styles
            Object.assign(largeDisplay.style, originalStyles);

            isFullscreen = false;
            toggleButton.textContent = 'Toggle Fullscreen';
        }
    });
});


/**
 * Initialize draggable and resizable functionalities for a modal.
 * @param {HTMLElement} modalEl - The modal element.
 */
function initializeModalInteractions(modalEl) {
    const modalHeader = modalEl.querySelector('.modal-header');
    const resizeHandles = modalEl.querySelectorAll('.resize-handle');

    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // Bring modal to the front when header is clicked
    modalHeader.addEventListener('mousedown', () => {
        bringModalToFront(modalEl);
    });

    // Draggable logic...
    modalHeader.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = modalEl.getBoundingClientRect();
        const backdropRect = modalBackdrop.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;

        document.addEventListener('mousemove', dragModal);
        document.addEventListener('mouseup', stopDragging);

        // Prevent text selection while dragging
        e.preventDefault();
    });

    function dragModal(e) {
        if (isDragging) {
            const backdropRect = modalBackdrop.getBoundingClientRect();
            const modalRect = modalEl.getBoundingClientRect();

            let newLeft = e.clientX - backdropRect.left - dragOffsetX;
            let newTop = e.clientY - backdropRect.top - dragOffsetY;

            // Constrain within backdrop
            newLeft = Math.max(0, Math.min(newLeft, backdropRect.width - modalRect.width));
            newTop = Math.max(0, Math.min(newTop, backdropRect.height - modalRect.height));

            modalEl.style.left = `${newLeft}px`;
            modalEl.style.top = `${newTop}px`;
        }
    }

    function stopDragging() {
        isDragging = false;
        document.removeEventListener('mousemove', dragModal);
        document.removeEventListener('mouseup', stopDragging);
    }

    // Resizable logic...
    resizeHandles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // Prevent triggering drag

            const rect = modalEl.getBoundingClientRect();
            const backdropRect = modalBackdrop.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = rect.width;
            const startHeight = rect.height;
            const startLeft = rect.left - backdropRect.left;
            const startTop = rect.top - backdropRect.top;

            const handleClass = handle.classList.contains('nw') ? 'nw' :
                                handle.classList.contains('ne') ? 'ne' :
                                handle.classList.contains('sw') ? 'sw' : 'se';

            function resizeModal(e) {
                let deltaX = e.clientX - startX;
                let deltaY = e.clientY - startY;

                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;

                if (handleClass.includes('e')) {
                    newWidth = startWidth + deltaX;
                }
                if (handleClass.includes('s')) {
                    newHeight = startHeight + deltaY;
                }
                if (handleClass.includes('w')) {
                    newWidth = startWidth - deltaX;
                    newLeft = startLeft + deltaX;
                }
                if (handleClass.includes('n')) {
                    newHeight = startHeight - deltaY;
                    newTop = startTop + deltaY;
                }

                // Set minimum size
                newWidth = Math.max(newWidth, 200);
                newHeight = Math.max(newHeight, 100);

                // Constrain within backdrop
                if (newLeft < 0) {
                    newWidth += newLeft;
                    newLeft = 0;
                }
                if (newTop < 0) {
                    newHeight += newTop;
                    newTop = 0;
                }
                if (newLeft + newWidth > backdropRect.width) {
                    newWidth = backdropRect.width - newLeft;
                }
                if (newTop + newHeight > backdropRect.height) {
                    newHeight = backdropRect.height - newTop;
                }

                modalEl.style.width = `${newWidth}px`;
                modalEl.style.height = `${newHeight}px`;
                modalEl.style.left = `${newLeft}px`;
                modalEl.style.top = `${newTop}px`;
            }

            function stopResizing() {
                document.removeEventListener('mousemove', resizeModal);
                document.removeEventListener('mouseup', stopResizing);
            }

            document.addEventListener('mousemove', resizeModal);
            document.addEventListener('mouseup', stopResizing);
        });
    });
}


/**
 * Close a specific modal.
 * @param {HTMLElement} modalEl - The modal element to close.
 */
function closeModal(modalEl) {
    const modalId = modalEl.dataset.modalId;

    // Remove the modal from the DOM
    modalEl.remove();

    // Hide backdrop if no more modals are open
    if (!modalBackdrop.querySelector('.modal')) {
        modalBackdrop.style.display = 'none';
    }

    // Remove modal data from allModals
    if (allModals[modalId]) {
        // Remove tray link if modal was minimized
        if (allModals[modalId].trayLink) {
            allModals[modalId].trayLink.remove();
        }
        delete allModals[modalId];
    }
}

/**
 * Minimize a modal by moving it to the system tray.
 * @param {HTMLElement} modalEl - The modal element to minimize.
 * @param {string} methodId - The method identifier.
 * @param {boolean} force - If true, bypass duplication check (used during import).
 */
function minimizeModal(modalEl, methodId, force = false) {
    const modalId = modalEl.dataset.modalId;

    // Get the selected text column
    const textColumnSelect = modalEl.querySelector('select[name="textColumn"]');
    const chosenCol = textColumnSelect ? textColumnSelect.value.trim() : '';

    if (!chosenCol) {
        alert("Please select a text column before minimizing.");
        return;
    }

    // Check for existing minimized modal with the same method and column, unless forced
    if (!force) {
        for (const existingId in allModals) {
            const entry = allModals[existingId];
            if (
                entry.methodId === methodId &&
                entry.chosenCol === chosenCol &&
                entry.state === 'minimized'
            ) {
                alert(`A minimized modal for "${modelDisplayNames[methodId] || methodId}" and column "${chosenCol}" already exists in the tray!`);
                return;
            }
        }
    }

    // Extract form fields before removing the modal
    const currentFields = getModalFields(modalEl);

    // Extract preview section content
    const previewSection = modalEl.querySelector('.preview-section');
    const previewHTML = previewSection ? previewSection.innerHTML : '';

    // Remove the modal from the backdrop
    modalEl.remove();
    if (!modalBackdrop.querySelector('.modal')) {
        modalBackdrop.style.display = 'none';
    }

    // Retrieve methodId from modalEl's dataset
    const methodIdFromModal = modalEl.dataset.methodName;
    const methodDisplayName = modelDisplayNames[methodIdFromModal] || 'Modal';
    const trayTitle = `${methodDisplayName} (${chosenCol})`;

    // Create a tray link button with the method's display name
    const trayLink = document.createElement('button');
    trayLink.type = 'button';
    trayLink.className = 'tray-link';
    trayLink.textContent = trayTitle;
    trayLink.onclick = () => restoreModal(modalId);

    systemTrayLinks.appendChild(trayLink);

    // Update the modal's state to minimized in allModals
    if (!allModals[modalId]) {
        allModals[modalId] = {
            methodId: methodIdFromModal,
            chosenCol: chosenCol,
            fields: currentFields,
            previewContent: previewHTML,
            state: 'minimized',
            checkpoints: [],
            trayLink: trayLink
        };
    } else {
        allModals[modalId].state = 'minimized';
        allModals[modalId].chosenCol = chosenCol;
        allModals[modalId].fields = currentFields;
        allModals[modalId].previewContent = previewHTML;
        allModals[modalId].trayLink = trayLink;
    }
}


/**
 * Restore a minimized modal from the system tray.
 * @param {string} modalId - The unique modal identifier.
 */
function restoreModal(modalId) {
    const entry = allModals[modalId];
    if (!entry || entry.state !== 'minimized') {
        alert("No minimized modal found with the specified ID.");
        return;
    }

    // Clone the original modal from the hidden template
    const templateId = MODAL_TEMPLATES[entry.methodId];
    const templateEl = document.getElementById(templateId);
    if (!templateEl) {
        alert("Modal template not found.");
        return;
    }

    const clonedModal = templateEl.querySelector('.modal').cloneNode(true);
    clonedModal.dataset.modalId = modalId;
    clonedModal.dataset.methodName = entry.methodId;

    // Populate the form fields with stored data
    setModalFields(clonedModal, entry.fields);

    // Populate the text column select options
    const textColumnSelect = clonedModal.querySelector('select[name="textColumn"]');
    if (textColumnSelect) {
        textColumnSelect.innerHTML = ''; // Clear existing options
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = '--- Select Column ---';
        textColumnSelect.appendChild(placeholderOption);
        datasetColumns.forEach(col => {
            const option = document.createElement('option');
            option.value = col;
            option.textContent = col;
            textColumnSelect.appendChild(option);
        });

        // Set the previously chosen column
        if (entry.chosenCol) {
            textColumnSelect.value = entry.chosenCol;
        }
    }

    // Restore the preview section content
    const previewSection = clonedModal.querySelector('.preview-section');
    if (previewSection && entry.previewContent) {
        previewSection.innerHTML = entry.previewContent;
    }

    // Append to the backdrop
    modalBackdrop.appendChild(clonedModal);
    modalBackdrop.style.display = 'flex';

    // Initialize draggable and resizable functionalities
    initializeModalInteractions(clonedModal);

    // Attach event listeners to control buttons
    const closeButton = clonedModal.querySelector('.close-btn');
    const minimizeButton = clonedModal.querySelector('.minimize-btn');
    const maximizeButton = clonedModal.querySelector('.maximize-btn');
    randomizeModalPosition(clonedModal);
    closeButton.onclick = () => closeModal(clonedModal);
    minimizeButton.onclick = () => minimizeModal(clonedModal, entry.methodId);
    maximizeButton.onclick = () => toggleMaximizeModal(clonedModal);

    // Attach event listeners to footer buttons based on method type
    const runButton = clonedModal.querySelector('.modal-footer .btn.run-btn');
    const downloadButton = clonedModal.querySelector('.modal-footer .btn.download-btn');

    if (runButton && downloadButton) {
        switch (entry.methodId) {
            case 'tfidf':
            case 'freq':
            case 'collocation':
                runButton.addEventListener('click', () => regenerateWordCloud(clonedModal, entry.methodId));
                downloadButton.addEventListener('click', () => downloadWordCloud(clonedModal, entry.methodId));
                break;
            case 'semanticwc':
                runButton.addEventListener('click', () => generateSemanticWordCloud(clonedModal));
                downloadButton.addEventListener('click', () => downloadWordCloud(clonedModal, entry.methodId));
                break;
            case 'lda':
            case 'nmf':
            case 'bertopic':
            case 'lsa':
                runButton.addEventListener('click', () => runTopicModeling(clonedModal, entry.methodId));
                downloadButton.addEventListener('click', () => downloadTopicModelingResults(clonedModal, entry.methodId));
                break;
            case 'rulebasedsa':
            case 'dlbasedsa':
            case 'absa':
            case 'zeroshotSentiment':
            case 'topicspecificwc':
                runButton.addEventListener('click', () => runSentimentAnalysis(clonedModal, entry.methodId));
                downloadButton.addEventListener('click', () => downloadSentimentAnalysisResults(clonedModal, entry.methodId));
                break;
            default:
                console.warn(`No run/download handlers defined for method ID: ${entry.methodId}`);
        }
    }

    // Restore checkpoints
    if (entry.checkpoints && Array.isArray(entry.checkpoints)) {
        entry.checkpoints.forEach(checkpoint => {
            addCheckpointToModal(clonedModal, checkpoint);
        });
    }

    // Remove the tray link
    if (entry.trayLink) {
        entry.trayLink.remove();
        delete allModals[modalId].trayLink;
    }

    // Update modal state to 'open'
    allModals[modalId].state = 'open';
}

/**
 * Toggle maximization of a modal.
 * @param {HTMLElement} modalEl - The modal element to maximize or restore.
 */
function toggleMaximizeModal(modalEl) {
    const modalId = modalEl.dataset.modalId;
    modalEl.classList.toggle('maximized');

    if (modalEl.classList.contains('maximized')) {
        // Store original position and size
        modalEl.dataset.originalLeft = modalEl.style.left;
        modalEl.dataset.originalTop = modalEl.style.top;
        modalEl.dataset.originalWidth = modalEl.style.width;
        modalEl.dataset.originalHeight = modalEl.style.height;

        // Maximize to fill the modal backdrop
        const backdropRect = modalBackdrop.getBoundingClientRect();
        modalEl.style.left = `0px`;
        modalEl.style.top = `0px`;
        modalEl.style.width = `${backdropRect.width}px`;
        modalEl.style.height = `${backdropRect.height}px`;

        // Update modal state
        if (allModals[modalId]) {
            allModals[modalId].state = 'maximized';
        }
    } else {
        // Restore original position and size
        modalEl.style.left = modalEl.dataset.originalLeft || '50%';
        modalEl.style.top = modalEl.dataset.originalTop || '50%';
        modalEl.style.width = modalEl.dataset.originalWidth || '40%';
        modalEl.style.height = modalEl.dataset.originalHeight || '60%';

        // Update modal state
        if (allModals[modalId]) {
            allModals[modalId].state = 'open';
        }
    }
}

/* ============ WORD CLOUD HANDLING ============ */

/**
 * Handle regenerating a word cloud.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} methodId - The method identifier (e.g., 'tfidf').
 */
async function regenerateWordCloud(modalEl, methodId) {
    try {
        const fields = getModalFields(modalEl);
        if (!fields.textColumn) {
            alert("Please select a text column.");
            return;
        }

        const payload = {
            method: methodId,                     // "tfidf", "freq", or "collocation"
            base64: currentFileBase64,
            fileName: currentFileName,
            column: fields.textColumn,
            maxWords: parseInt(fields.maxWords) || 500,
            stopwords: !!fields.stopwords,
            excludeWords: fields.excludeWords ? fields.excludeWords.split(",").map(word => word.trim()).filter(word => word) : []
        };

        if (methodId === 'collocation') {
            payload.windowSize = parseInt(fields.windowSize) || 2;
        }

        showLoading();
        const response = await fetch("/process/wordcloud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        hideLoading();

        if (!response.ok) {
            alert(data.error || "Error generating word cloud.");
            return;
        }

        if (data.image) {
            const previewSection = modalEl.querySelector(".preview-section");
            previewSection.innerHTML = "";
            const img = document.createElement("img");
            img.src = data.image;
            img.alt = "Word Cloud Preview";
            previewSection.appendChild(img);

            // Capture the rendered output as HTML
            const outputData = previewSection.innerHTML;

            // Create a checkpoint with current config and output data
            const checkpointConfig = {
                methodId: methodId,
                fields: fields
                // Add any other necessary parameters
            };
            createCheckpoint(modalEl, checkpointConfig, outputData);
        } else {
            alert(data.error || "No image returned from server.");
        }
    } catch (error) {
        hideLoading();
        console.error(error);
        alert("Error generating word cloud: " + error.message);
    }
}

/**
 * Handle downloading the generated word cloud.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} methodId - The method identifier.
 */
function downloadWordCloud(modalEl, methodId) {
    const previewSection = modalEl.querySelector(".preview-section");
    const img = previewSection.querySelector("img");
    if (!img || !img.src) {
        alert("No word cloud image available to download.");
        return;
    }

    const link = document.createElement('a');
    link.href = img.src;
    link.download = `${methodId}_word_cloud.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Handle generating a semantic word cloud.
 * @param {HTMLElement} modalEl - The modal element.
 */
async function generateSemanticWordCloud(modalEl) {
    try {
        const fields = getModalFields(modalEl);
        if (!fields.textColumn || !fields.query || !fields.embeddingModel) {
            alert("Please select a text column, enter a query, and specify the embedding model.");
            return;
        }

        const payload = {
            query: fields.query,
            embeddingModel: fields.embeddingModel,
            base64: currentFileBase64,
            fileName: currentFileName,
            column: fields.textColumn,
            maxWords: parseInt(fields.maxWords) || 500,
            stopwords: !!fields.stopwords,
            excludeWords: fields.excludeWords ? fields.excludeWords.split(",").map(word => word.trim()).filter(word => word) : []
        };

        showLoading();
        const response = await fetch("/process/semantic_wordcloud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        hideLoading();

        if (!response.ok) {
            alert(data.error || "Error generating semantic word cloud.");
            return;
        }

        if (data.image) {
            const previewSection = modalEl.querySelector(".preview-section");
            previewSection.innerHTML = "";
            const img = document.createElement("img");
            img.src = data.image;
            img.alt = "Semantic Word Cloud Preview";
            previewSection.appendChild(img);

            // Capture the rendered output as HTML
            const outputData = previewSection.innerHTML;

            // Create a checkpoint with current config and output data
            const checkpointConfig = {
                methodId: 'semanticwc',
                fields: fields
                // Add any other necessary parameters
            };
            createCheckpoint(modalEl, checkpointConfig, outputData);
        } else {
            alert(data.error || "No image returned from server.");
        }
    } catch (error) {
        hideLoading();
        console.error(error);
        alert("Error generating semantic word cloud: " + error.message);
    }
}

/* ============ TOPIC MODELING HANDLING ============ */

/**
 * Handle running topic modeling.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} methodId - The method identifier (e.g., 'lda').
 */
async function runTopicModeling(modalEl, methodId) {
    try {
      const fields = getModalFields(modalEl);
      if (!fields.textColumn) {
        alert("Please select a text column.");
        return;
      }
  
      // Build the basic payload
      const payload = {
        method: methodId,                     // "lda", "nmf", "bertopic", or "lsa"
        base64: currentFileBase64,
        column: fields.textColumn,
        numTopics: parseInt(fields.numTopics) || 5,
        wordsPerTopic: parseInt(fields.wordsPerTopic) || 5,
        randomState: parseInt(fields.randomState) || 42,
        stopwords: !!fields.stopwords,
        embeddingModel: fields.embeddingModel || ""
      };
  
      // If coherence analysis is enabled in the modal, include extra parameters
      if (fields.coherence_analysis === "on" || fields.coherence_analysis === true) {
        payload.coherence_analysis = true;
        payload.min_topics = parseInt(fields.min_topics) || 2;
        payload.max_topics = parseInt(fields.max_topics) || (parseInt(fields.numTopics) || 5);
        payload.step = parseInt(fields.step) || 1;
      }
  
      showLoading();
      const response = await fetch("/process/topic_modeling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
  
      const data = await response.json();
      hideLoading();
  
      if (!response.ok) {
        alert(data.error || "Error running topic modeling.");
        return;
      }
  
      const previewSection = modalEl.querySelector(".preview-section");
      previewSection.innerHTML = "";
  
      // Display standard topic modeling results
      if (data.topics && Array.isArray(data.topics) && data.topics.length > 0) {
        const heading = document.createElement("h3");
        heading.textContent = "Extracted Topics:";
        previewSection.appendChild(heading);
  
        const list = document.createElement("ul");
        data.topics.forEach((topic, index) => {
          const listItem = document.createElement("li");
          listItem.textContent = `Topic ${index + 1}: ${topic}`;
          list.appendChild(listItem);
        });
        previewSection.appendChild(list);
      } else {
        const message = document.createElement("p");
        message.textContent = "No topics were extracted.";
        previewSection.appendChild(message);
      }
  
      // If coherence analysis was performed, display the coherence plot and best score
      if (data.coherence_analysis) {
        const coherenceDiv = document.createElement("div");
        coherenceDiv.className = "coherence-analysis";
        coherenceDiv.style.marginTop = "1rem";
  
        const plotHeading = document.createElement("h4");
        plotHeading.textContent = "Coherence Analysis";
        coherenceDiv.appendChild(plotHeading);
  
        const plotImg = document.createElement("img");
        plotImg.src = data.coherence_analysis.coherence_plot;
        plotImg.alt = "Coherence Analysis Plot";
        plotImg.style.maxWidth = "100%";
        coherenceDiv.appendChild(plotImg);
  
        const bestInfo = document.createElement("p");
        bestInfo.textContent = `Best Coherence: ${data.coherence_analysis.best_coherence.toFixed(4)} at ${data.coherence_analysis.best_topic} topics.`;
        coherenceDiv.appendChild(bestInfo);
  
        previewSection.appendChild(coherenceDiv);
      }
  
      // Capture the rendered output as HTML for checkpointing
      const outputData = previewSection.innerHTML;
      const checkpointConfig = {
        methodId: methodId,
        fields: fields
        // You can include additional parameters if needed
      };
      createCheckpoint(modalEl, checkpointConfig, outputData);
    } catch (error) {
      hideLoading();
      console.error(error);
      alert("Error running topic modeling: " + error.message);
    }
  }
  
/**
 * Handle downloading topic modeling results.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} methodId - The method identifier.
 */
function downloadTopicModelingResults(modalEl, methodId) {
    const previewSection = modalEl.querySelector(".preview-section");
    const topics = previewSection.querySelector("ul");
    if (!topics) {
        alert("No topic modeling results available to download.");
        return;
    }

    const topicsArray = Array.from(topics.querySelectorAll("li")).map(li => li.textContent);
    const blob = new Blob([topicsArray.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${methodId}_topic_modeling_results.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/* ============ SENTIMENT ANALYSIS HANDLING ============ */

/**
 * Handle running sentiment analysis.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} methodId - The method identifier ("rulebasedsa", "dlbasedsa", "absa", "zeroshotSentiment").
 */
async function runSentimentAnalysis(modalEl, methodId) {
    try {
        const fields = getModalFields(modalEl);
        if (!fields.textColumn) {
            alert("Please select a text column.");
            return;
        }

        const payload = {
            method: methodId, // "rulebasedsa", "dlbasedsa", "absa", "zeroshotSentiment"
            base64: currentFileBase64,
            fileType: currentFileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv',
            column: fields.textColumn,
        };

        // Add specific fields based on method
        switch (methodId) {
            case 'rulebasedsa':
                payload.ruleBasedModel = fields.ruleBasedModel || "textblob";
                break;
            case 'dlbasedsa':
                payload.dlModel = fields.dlModel || "distilbert-base-uncased-finetuned-sst-2-english";
                break;
            case 'absa':
                payload.aspect = fields.aspect || "";
                payload.model = fields.modelName || "llama3"; // Default model if needed
                break;
            case 'zeroshotSentiment':
                payload.model = fields.modelName || "llama3"; // Ensure model field is included
                break;
            default:
                console.warn(`No additional fields defined for method ID: ${methodId}`);
        }

        showLoading();

        const endpointMap = {
            'rulebasedsa': "/process/sentiment",
            'dlbasedsa': "/process/sentiment",
            'absa': "/process/absa",
            'zeroshotSentiment': "/process/zero_shot_sentiment"
        };

        const endpoint = endpointMap[methodId] || "/process/sentiment";

        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        hideLoading();

        if (!response.ok) {
            alert(data.error || "Error running sentiment analysis.");
            return;
        }

        const previewSection = modalEl.querySelector(".preview-section");
        previewSection.innerHTML = "";

        // Debugging: Log the received data
        console.log(`Received data for ${methodId}:`, data);

        if (methodId === 'absa') {
            // Existing ABSA rendering logic (Assuming it's correctly implemented)
            renderABSAResults(previewSection, data);
        } else if (methodId === 'zeroshotSentiment') {
            // New rendering logic for Zero-Shot Sentiment Analysis
            renderZeroShotSentimentResults(previewSection, data);
        } else {
            // Handle other sentiment analysis methods that return data.stats
            renderOtherSentimentResults(previewSection, data);
        }

        // Capture the rendered output as HTML for checkpointing
        const outputData = previewSection.innerHTML;

        // Create a checkpoint with current config and output data
        const checkpointConfig = {
            methodId: methodId,
            fields: fields
            // Add any other necessary parameters
        };
        createCheckpoint(modalEl, checkpointConfig, outputData);
    } catch (error) {
        hideLoading();
        console.error(error);
        alert("Error running sentiment analysis: " + error.message);
    }
}

/**
 * Render ABSA (Aspect-Based Sentiment Analysis) results.
 * @param {HTMLElement} previewSection - The section to render results into.
 * @param {Object} data - The backend response data.
 */
function renderABSAResults(previewSection, data) {
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        // Summary Table
        const summaryHeading = document.createElement("h5");
        summaryHeading.textContent = "Sentiment Summary:";
        summaryHeading.style.marginTop = "1rem";
        previewSection.appendChild(summaryHeading);

        const sentimentCounts = data.results.reduce((acc, curr) => {
            acc[curr.sentiment] = (acc[curr.sentiment] || 0) + 1;
            return acc;
        }, {});

        const total = data.results.length;
        const sentiments = ["Positive", "Neutral", "Negative"];

        const summaryTable = document.createElement("table");
        summaryTable.className = "summary-table";
        summaryTable.style.marginBottom = "1rem";

        summaryTable.innerHTML = `
            <thead>
                <tr>
                    <th>Sentiment</th>
                    <th>Count</th>
                    <th>Percentage</th>
                </tr>
            </thead>
            <tbody>
                ${sentiments.map(sentiment => `
                    <tr>
                        <td>${sentiment}</td>
                        <td>${sentimentCounts[sentiment] || 0}</td>
                        <td>${((sentimentCounts[sentiment] || 0) / total * 100).toFixed(2)}%</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        previewSection.appendChild(summaryTable);

        // Detailed Results Table
        const detailedHeading = document.createElement("h5");
        detailedHeading.textContent = "Detailed Sentiment Results:";
        detailedHeading.style.marginTop = "1rem";
        previewSection.appendChild(detailedHeading);

        const table = document.createElement("table");
        table.className = "results-table";

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Text</th>
                    <th>Aspect</th>
                    <th>Sentiment</th>
                </tr>
            </thead>
            <tbody>
                ${data.results.map(result => `
                    <tr>
                        <td>${escapeHtml(result.text)}</td>
                        <td>${escapeHtml(result.aspect)}</td>
                        <td>${result.sentiment}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        previewSection.appendChild(table);
    } else {
        const message = document.createElement("p");
        message.textContent = "No ABSA results available.";
        previewSection.appendChild(message);
    }
}

/**
 * Render Zero-Shot Sentiment Analysis results.
 * @param {HTMLElement} previewSection - The section to render results into.
 * @param {Object} data - The backend response data.
 */
function renderZeroShotSentimentResults(previewSection, data) {
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        // Summary Table
        const summaryHeading = document.createElement("h5");
        summaryHeading.textContent = "Sentiment Summary:";
        summaryHeading.style.marginTop = "1rem";
        previewSection.appendChild(summaryHeading);

        const sentimentCounts = data.results.reduce((acc, curr) => {
            acc[curr.sentiment] = (acc[curr.sentiment] || 0) + 1;
            return acc;
        }, {});

        const total = data.results.length;
        const sentiments = ["Positive", "Neutral", "Negative"];

        const summaryTable = document.createElement("table");
        summaryTable.className = "summary-table";
        summaryTable.style.marginBottom = "1rem";

        summaryTable.innerHTML = `
            <thead>
                <tr>
                    <th>Sentiment</th>
                    <th>Count</th>
                    <th>Percentage</th>
                </tr>
            </thead>
            <tbody>
                ${sentiments.map(sentiment => `
                    <tr>
                        <td>${sentiment}</td>
                        <td>${sentimentCounts[sentiment] || 0}</td>
                        <td>${((sentimentCounts[sentiment] || 0) / total * 100).toFixed(2)}%</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        previewSection.appendChild(summaryTable);

        // Detailed Results Table
        const detailedHeading = document.createElement("h5");
        detailedHeading.textContent = "Zero-Shot Sentiment Analysis Results:";
        detailedHeading.style.marginTop = "1rem";
        previewSection.appendChild(detailedHeading);

        const table = document.createElement("table");
        table.className = "results-table";

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Text</th>
                    <th>Sentiment</th>
                </tr>
            </thead>
            <tbody>
                ${data.results.map(result => `
                    <tr>
                        <td>${escapeHtml(result.text)}</td>
                        <td>${result.sentiment}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        previewSection.appendChild(table);
    } else {
        const message = document.createElement("p");
        message.textContent = "No sentiment analysis results available.";
        previewSection.appendChild(message);
    }
}

/**
 * Bring the clicked modal to the top by updating its z-index.
 * @param {HTMLElement} modalEl - The modal element.
 */
function bringModalToFront(modalEl) {
    // Find the highest z-index among all modals
    const allModals = document.querySelectorAll('.modal');
    let highestZIndex = 0;
    allModals.forEach(modal => {
        const zIndex = parseInt(window.getComputedStyle(modal).zIndex, 10) || 0;
        if (zIndex > highestZIndex) {
            highestZIndex = zIndex;
        }
    });

    // Set the clicked modal's z-index to be one higher than the highest
    modalEl.style.zIndex = highestZIndex + 1;
}

/**
 * Render sentiment analysis results for other methods (e.g., rulebasedsa, dlbasedsa).
 * @param {HTMLElement} previewSection - The section to render results into.
 * @param {Object} data - The backend response data.
 */
function renderOtherSentimentResults(previewSection, data) {
    if (data.stats) {
        // Detailed Results Table
        const detailedHeading = document.createElement("h5");
        detailedHeading.textContent = "Sentiment Analysis Results:";
        detailedHeading.style.marginTop = "1rem";
        previewSection.appendChild(detailedHeading);

        const table = document.createElement("table");
        table.className = "results-table";

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Sentiment</th>
                    <th>Count</th>
                    <th>Average Score</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(data.stats).map(([sentiment, values]) => `
                    <tr>
                        <td>${sentiment}</td>
                        <td>${values.Count}</td>
                        <td>${values["Average Score"] !== null ? values["Average Score"] : "N/A"}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        previewSection.appendChild(table);
    } else {
        const message = document.createElement("p");
        message.textContent = "No sentiment analysis results available.";
        previewSection.appendChild(message);
    }
}


/**
 * Utility function to escape HTML to prevent XSS.
 * @param {string} unsafe - The unsafe string to escape.
 * @returns {string} - The escaped string.
 */
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/**
 * Handle downloading sentiment analysis results.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} methodId - The method identifier.
 */
function downloadSentimentAnalysisResults(modalEl, methodId) {
    const previewSection = modalEl.querySelector(".preview-section");
    const table = previewSection.querySelector("table");
    if (!table) {
        alert("No sentiment analysis results available to download.");
        return;
    }

    const csvRows = [];
    const headers = Array.from(table.querySelectorAll("thead th")).map(th => th.textContent);
    csvRows.push(headers.join(","));

    const rows = table.querySelectorAll("tbody tr");
    rows.forEach(row => {
        const cols = row.querySelectorAll("td");
        const sentiment = cols[0].textContent;
        const count = cols[1].textContent;
        const avgScore = cols[2].textContent;
        csvRows.push(`${sentiment},${count},${avgScore}`);
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${methodId}_sentiment_analysis_results.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Restore a modal's state from a specific checkpoint.
 * @param {HTMLElement} modalEl - The modal element.
 * @param {string} checkpointId - The unique identifier for the checkpoint.
 */
function restoreCheckpoint(modalEl, checkpointId) {
    const modalId = modalEl.dataset.modalId;
    const checkpoint = allModals[modalId]?.checkpoints.find(cp => cp.id === checkpointId);
    
    // Debugging: Log the modalId and checkpointId
    console.log(`Attempting to restore checkpoint: ${checkpointId} for modal: ${modalId}`);
    
    if (!checkpoint) {
        alert("Checkpoint not found.");
        console.error(`Checkpoint with ID ${checkpointId} not found in allModals.`);
        return;
    }
    
    const { config, outputData } = checkpoint;
    if (!config || !config.fields) {
        alert("Invalid checkpoint configuration.");
        console.error("Checkpoint configuration is invalid:", checkpoint);
        return;
    }
    
    // Restore form fields
    setModalFields(modalEl, config.fields);
    
    // Restore preview data
    const previewSection = modalEl.querySelector('.preview-section');
    if (previewSection && outputData) {
        previewSection.innerHTML = outputData;
    }
    
    // Update modal state if needed
    if (modalEl.classList.contains('minimized')) {
        // Optionally, toggle to open state
        // toggleMinimizeModal(modalEl);
    }
    
    
    // Update the allModals entry with the restored data
    allModals[modalId].fields = config.fields;
    allModals[modalId].previewContent = outputData;
}

/* ============ SYSTEM TRAY CLICK TO MINIMIZE MODAL ============ */
// Note: This event listener is already handled in the 'minimizeModal' function when clicking on the backdrop.

 /* ============ BACKDROP CLICK TO MINIMIZE MODAL ============ */
modalBackdrop.addEventListener('click', function (event) {
    // Ensure the click occurred directly on the backdrop, not on a modal or its content
    if (event.target === this) {
        const modals = this.querySelectorAll('.modal');
        if (modals.length > 0) {
            const lastModal = modals[modals.length - 1]; // Get the last opened modal
            const methodId = lastModal.dataset.methodName;
            minimizeModal(lastModal, methodId); // Minimize the last modal
        }
    }
});

/* ============ DISABLE BODY SCROLL WHEN MODAL OPEN ============ */
const originalBodyOverflow = document.body.style.overflow;

modalBackdrop.addEventListener('transitionstart', () => {
    if (modalBackdrop.style.display === 'flex') {
        document.body.style.overflow = 'hidden';
    }
});

modalBackdrop.addEventListener('transitionend', () => {
    if (modalBackdrop.style.display !== 'flex') {
        document.body.style.overflow = originalBodyOverflow;
    }
});


let sessionKey = ""; // Fallback key for testing purposes';

// Generate a key from the session password
async function generateKeyFromPassword(password) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("Semantic-Sapience-proj"), // Add a fixed salt
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypt data
async function encryptData(data) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedData = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    encoder.encode(data)
  );
  return { encryptedData, iv };
}

async function decryptData(encryptedData, iv, key = null) {
    const decryptionKey = key || sessionKey; // If no key passed, fallback to the global sessionKey
    const decoder = new TextDecoder();
    const decryptedData = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      decryptionKey,
      encryptedData
    );
    return decoder.decode(decryptedData);
  }
  
// Set session key on welcome overlay close
async function closeWelcomeOverlay() {
    const password = document.getElementById("sessionPassword").value;
    if (!password) {
      alert("Please enter a session password.");
      return;
    }
    sessionKey = await generateKeyFromPassword(password);
    alert("Session key initialized:", sessionKey); // Debugging
    document.querySelector(".welcome-overlay").style.display = "none";
  }
  

// Existing JavaScript code...

/* ============ SYSTEM STATISTICS HANDLING ============ */

/**
 * Fetch system statistics from the backend and update the UI.
 */
// Existing JavaScript code...

/* ============ SYSTEM STATISTICS HANDLING WITH PROGRESS BARS ============ */

/**
 * Fetch system statistics from the backend and update the UI with progress bars.
 */
async function fetchSystemStats() {
    try {
        const response = await fetch('/system_stats');
        if (!response.ok) {
            console.error('Failed to fetch system stats:', response.statusText);
            return;
        }
        const stats = await response.json();

        // Update CPU Utilization
        const cpuUtilization = stats.cpu_utilization_percent;
        document.getElementById('cpuUtilizationText').textContent = `${cpuUtilization}%`;
        updateProgressBar('cpuUtilizationBar', cpuUtilization, 'cpu');

        // Update RAM Utilization
        const ramUtilization = stats.ram_utilization_percent;
        document.getElementById('ramUtilizationText').textContent = `${ramUtilization}%`;
        updateProgressBar('ramUtilizationBar', ramUtilization, 'ram');

    } catch (error) {
        console.error('Error fetching system stats:', error);
    }
}

/**
 * Update the width and color of a progress bar based on the value.
 * @param {string} barId - The ID of the progress-fill div.
 * @param {number|string} value - The value to represent (percentage or GB).
 * @param {string} type - The type of stat ('cpu', 'ram', 'ramAvailable', etc.) for color coding.
 */
function updateProgressBar(barId, value, type) {
    const progressBar = document.getElementById(barId);
    if (!progressBar) return;
    progressBar.style.width = `${value}%`;
}

/**
 * Initialize system stats fetching at regular intervals.
 */
function initializeSystemStats() {
    // Fetch stats immediately upon loading
    fetchSystemStats();

    // Set interval to fetch stats every 5 seconds (5000 milliseconds)
    setInterval(fetchSystemStats, 2000);
}
