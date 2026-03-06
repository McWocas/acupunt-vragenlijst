class Vragenlijst extends HTMLElement {
    static observedAttributes = ['endpoint', 'project-id', 'vragenlijst-id'];
    
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.vragen = [];
        this.vragenlijstData = null;
        this.sdk = null;
        this.nameInput = null;
        this.nameError = null;
        this.lastNameInput = null;
        this.lastNameError = null;
        this.emailInput = null;
        this.emailError = null;
        this._answers = [];
        this._appwriteLoaded = false;
        this.sliders = [];
    }

    static STORAGE_PREFIX = 'vragenlijst_';
    static STORAGE_EXPIRY_DAYS = 10;
    
    static ACCENT_COLOR = '#c4a127';

    connectedCallback() {
        this.render();
        this.loadAppwriteScript();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue && this._appwriteLoaded) {
            this.loadVragenlijst();
        }
    }

    loadAppwriteScript() {
        if (this._appwriteLoaded || typeof Appwrite !== 'undefined') {
            this._appwriteLoaded = true;
            this.initAppwrite();
            this.loadVragenlijst();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/appwrite@22.4.1/dist/iife/sdk.min.js';
        script.async = true;
        script.defer = true;
        
        script.onload = () => {
            this._appwriteLoaded = true;
            this.initAppwrite();
            this.loadVragenlijst();
        };

        script.onerror = (error) => {
            console.error('Failed to load from:', 'https://cdn.jsdelivr.net/npm/appwrite@22.4.1/dist/iife/sdk.min.js', error);
        };

        document.head.appendChild(script);
    }

    initAppwrite() {
        try {
            const { Client, TablesDB, Functions, Account, ExecutionMethod } = Appwrite;
            
            const client = new Client()
                .setEndpoint(this.endpoint)
                .setProject(this.projectId);
            
            this.sdk = {
                client: client,
                databases: new TablesDB(client),
                functions: new Functions(client),
                account: new Account(client),
                execute: ExecutionMethod.POST
            };
        } catch (error) {
            console.error('Failed to initialize Appwrite:', error);
            this.showError('Failed to initialize Appwrite SDK: ' + error.message);
        }
    }

    get endpoint() {
        return this.getAttribute('endpoint') || 'https://appwrite.wocas.be/v1';
    }

    get projectId() {
        return this.getAttribute('project-id');
    }

    get vragenlijstId() {
        return this.getAttribute('vragenlijst-id');
    }

    saveToStorage(data) {
        try {
            const key = Vragenlijst.STORAGE_PREFIX + this.vragenlijstId;
            const item = {
                data: data,
                timestamp: Date.now(),
                expires: Date.now() + (Vragenlijst.STORAGE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
            };
            localStorage.setItem(key, JSON.stringify(item));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    }

    loadFromStorage() {
        try {
            const key = Vragenlijst.STORAGE_PREFIX + this.vragenlijstId;
            const item = localStorage.getItem(key);
            if (!item) return null;

            const parsed = JSON.parse(item);
            if (parsed.expires < Date.now()) {
                this.clearStorage();
                return null;
            }
            return parsed.data;
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            return null;
        }
    }

    clearStorage() {
        try {
            localStorage.removeItem(Vragenlijst.STORAGE_PREFIX + this.vragenlijstId);
        } catch (error) {
            console.error('Failed to clear localStorage:', error);
        }
    }

    async loadVragenlijst() {
        try {
            if (!this.vragenlijstId) {
                throw new Error('vragenlijst-id attribute is required');
            }
            
            const document = await this.sdk.databases.getRow(
                'vragenlijst',
                'vragenlijst',
                this.vragenlijstId
            );

            this.vragenlijstData = document;
            this.vragen = document.vragen || [];

            const savedData = this.loadFromStorage();
            this.renderVragenlijst(savedData);

            this.dispatchEvent(new CustomEvent('vragenlijst-loaded', {
                detail: { vragenlijst: this.vragenlijstData }
            }));

        } catch (error) {
            console.error('Failed to load vragenlijst:', error);
            
            let errorMessage = 'Failed to load vragenlijst: ';
            if (error.message.includes('401') || error.message.includes('unauthorized')) {
                errorMessage += 'Controleer uw project-id en endpoint.';
            } else if (error.message.includes('404')) {
                errorMessage += 'Vragenlijst niet gevonden.';
            } else {
                errorMessage += error.message;
            }
            
            this.showError(errorMessage);
        }
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>${this.getStyles()}</style>
            <div class="vragenlijst-container">
                <div class="vragenlijst-loading">
                    <div class="loading-spinner"></div>
                    <div>Vragenlijst laden...</div>
                </div>
            </div>
        `;
    }

    renderVragenlijst(savedData = null) {
        const container = document.createElement('div');
        container.className = 'vragenlijst-content';

        const title = document.createElement('h2');
        title.className = 'vragenlijst-title';
        title.textContent = this.vragenlijstData?.naam || 'Vragenlijst';
        container.appendChild(title);

        if (this.vragenlijstData?.description) {
            const description = document.createElement('p');
            description.className = 'vragenlijst-description';
            description.textContent = this.vragenlijstData.description;
            container.appendChild(description);
        }

        this.vragen.forEach((question, index) => {
            container.appendChild(this.createQuestionElement(
                question, 
                index, 
                savedData?.answers ? savedData.answers[index] : 3
            ));
        });

        container.appendChild(this.createNameSection(savedData?.name, savedData?.lastName));
        container.appendChild(this.createEmailSection(savedData?.email));
        container.appendChild(this.createSubmitButton());

        const loadingDiv = this.shadowRoot.querySelector('.vragenlijst-container');
        loadingDiv.innerHTML = '';
        loadingDiv.appendChild(container);

        this.attachSaveListeners();
    }

    createQuestionElement(question, index, savedValue = 3) {
        const container = document.createElement('div');
        container.className = 'vragenlijst-question';
        container.dataset.questionIndex = index;

        const questionText = document.createElement('div');
        questionText.className = 'vragenlijst-question-text';
        questionText.textContent = `${index + 1}. ${question}`;
        container.appendChild(questionText);

        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'vragenlijst-slider-container';

        const labelRow = document.createElement('div');
        labelRow.className = 'vragenlijst-slider-labels';
        labelRow.innerHTML = `
            <span class="label-left">Totaal niet</span>
            <span class="label-center">Neutraal</span>
            <span class="label-right">Totaal wel</span>
        `;
        sliderContainer.appendChild(labelRow);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'vragenlijst-slider';
        slider.min = '1';
        slider.max = '5';
        slider.value = savedValue;
        slider.step = '1';
        slider.dataset.questionIndex = index;
        
        slider.addEventListener('input', (e) => {
            this.handleSliderInput(e);
        });

        sliderContainer.appendChild(slider);

        this.sliders[index] = slider;

        container.appendChild(sliderContainer);
        return container;
    }

    handleSliderInput(event) {
        this.saveProgress();
    }

    createNameSection(savedName = null, savedLastName = null) {
        const container = document.createElement('div');
        container.className = 'vragenlijst-text-input-section vragenlijst-double';
        const subcontainer1 = document.createElement('div');
        subcontainer1.className = 'vragenlijst-text-input-section vragenlijst-sub';

        const subcontainer2 = document.createElement('div');
        subcontainer2.className = 'vragenlijst-text-input-section vragenlijst-sub';

        const label = document.createElement('label');
        label.className = 'vragenlijst-text-input-label';
        label.textContent = 'Voornaam';
        subcontainer1.appendChild(label);

        this.nameInput = document.createElement('input');
        this.nameInput.type = 'text';
        this.nameInput.className = 'vragenlijst-text-input-input';
        this.nameInput.setAttribute('aria-label', 'Voornaam');

        if (savedName) {
            this.nameInput.value = savedName;
        }

        subcontainer1.appendChild(this.nameInput);

        this.nameError = document.createElement('div');
        this.nameError.className = 'vragenlijst-text-input-error';
        subcontainer1.appendChild(this.nameError);

        const label2 = document.createElement('label');
        label2.className = 'vragenlijst-text-input-label';
        label2.textContent = 'Achternaam';
        subcontainer2.appendChild(label2);

        this.lastNameInput = document.createElement('input');
        this.lastNameInput.type = 'text';
        this.lastNameInput.className = 'vragenlijst-text-input-input';
        this.lastNameInput.setAttribute('aria-label', 'Achternaam');

        if (savedLastName) {
            this.lastNameInput.value = savedLastName;
        }

        subcontainer2.appendChild(this.lastNameInput);

        this.lastNameError = document.createElement('div');
        this.lastNameError.className = 'vragenlijst-text-input-error';
        subcontainer2.appendChild(this.lastNameError);
        container.appendChild(subcontainer1);

        container.appendChild(subcontainer2);
        return container;
    }

    createEmailSection(savedEmail = null) {
        const container = document.createElement('div');
        container.className = 'vragenlijst-text-input-section';

        const label = document.createElement('label');
        label.className = 'vragenlijst-text-input-label';
        label.textContent = 'E-mailadres';
        container.appendChild(label);

        this.emailInput = document.createElement('input');
        this.emailInput.type = 'email';
        this.emailInput.className = 'vragenlijst-text-input-input';
        this.emailInput.placeholder = 'naam@example.com';
        this.emailInput.setAttribute('aria-label', 'E-mailadres');

        if (savedEmail) {
            this.emailInput.value = savedEmail;
        }

        container.appendChild(this.emailInput);

        this.emailError = document.createElement('div');
        this.emailError.className = 'vragenlijst-text-input-error';
        container.appendChild(this.emailError);

        return container;
    }

    createSubmitButton() {
        const button = document.createElement('button');
        button.className = 'vragenlijst-submit-button';
        button.textContent = 'Verzenden';
        button.setAttribute('aria-label', 'Vragenlijst verzenden');
        button.addEventListener('click', () => this.submitVragenlijst());
        return button;
    }

    attachSaveListeners() {
        let emailTimeout;
        this.emailInput.addEventListener('input', () => {
            clearTimeout(emailTimeout);
            emailTimeout = setTimeout(() => this.saveProgress(), 500);
        });

        let nameTimeout;
        this.nameInput.addEventListener('input', () => {
            clearTimeout(nameTimeout);
            nameTimeout = setTimeout(() => this.saveProgress(), 500);
        });

        let lastNameTimeout;
        this.lastNameInput.addEventListener('input', () => {
            clearTimeout(lastNameTimeout);
            lastNameTimeout = setTimeout(() => this.saveProgress(), 500);
        });
    }

    saveProgress() {
        const answers = this.getAnswers();
        const email = this.emailInput.value.trim();
        const name = this.nameInput.value.trim();
        const lastName = this.lastNameInput.value.trim();

        this.saveToStorage({
            answers: answers,
            email: email,
            name: name,
            lastName: lastName,
            lastSaved: Date.now()
        });
    }

    getAnswers() {
        const answers = [];
        for (let i = 0; i < this.vragen.length; i++) {
            const slider = this.shadowRoot.querySelector(`.vragenlijst-slider[data-question-index="${i}"]`);
            answers.push(slider ? parseInt(slider.value) : null);
        }
        return answers;
    }

    async submitVragenlijst() {
        try {
            const submitButton = this.shadowRoot.querySelector('.vragenlijst-submit-button');
            submitButton.disabled = true;
            submitButton.textContent = 'Verzenden...';

            const isEmailValid = this.validateEmail();
            const isNameValid = this.validateName();
            const isLastNameValid = this.validateLastName();

            if (!isEmailValid || !isNameValid || !isLastNameValid) {
                submitButton.disabled = false;
                submitButton.textContent = 'Verzenden';
                return;
            }

            const answers = this.getAnswers();
            
            const unansweredIndexes = answers.reduce((acc, answer, index) => {
                if (answer === null || answer === undefined) acc.push(index + 1);
                return acc;
            }, []);

            if (unansweredIndexes.length > 0) {
                alert(`Beantwoord alstublieft alle vragen (vraag ${unansweredIndexes.join(', ')})`);
                submitButton.disabled = false;
                submitButton.textContent = 'Verzenden';
                return;
            }

            const antwoordData = {
                mail: this.emailInput.value.trim(),
                naam: this.nameInput.value.trim(),
                achternaam: this.lastNameInput.value.trim(),
                vragenlijst: this.vragenlijstId,
                antwoorden: answers
            };
            
            try {
                const execution = await this.sdk.functions.createExecution(
                    '699eee510006c2160737',
                    JSON.stringify(antwoordData),
                    false,
                    '/',
                    this.sdk.execute
                );

                this.clearStorage();
                this.showSuccessMessage();
                this.resetForm();

                this.dispatchEvent(new CustomEvent('vragenlijst-submitted', {
                    detail: { answers }
                }));

            } catch (err) {
                console.error("ERROR FULL OBJECT:", err);
                throw new Error('Fout bij verzenden naar server');
            }

        } catch (error) {
            console.error('Error submitting:', error);
            
            let errorMessage = 'Er is een fout opgetreden bij het verzenden. ';
            errorMessage += error.message;
            alert(errorMessage);
            
        } finally {
            const submitButton = this.shadowRoot.querySelector('.vragenlijst-submit-button');
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = 'Verzenden';
            }
        }
    }

    validateEmail() {
        const email = this.emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email) {
            this.showEmailError('Een E-mailadres is verplicht');
            return false;
        }
        if (!emailRegex.test(email)) {
            this.showEmailError('Voer een geldig e-mailadres in');
            return false;
        }

        this.emailError.style.display = 'none';
        this.emailInput.classList.remove('error');
        return true;
    }

    validateName() {
        const name = this.nameInput.value.trim();

        if (!name) {
            this.showNameError('Een naam is verplicht');
            return false;
        }

        this.nameError.style.display = 'none';
        this.nameInput.classList.remove('error');

        return true;
    }

    validateLastName() {
        const lastName = this.lastNameInput.value.trim();

        if (!lastName) {
            this.showLastNameError('Een achternaam is verplicht');
            return false;
        }

        this.lastNameError.style.display = 'none';
        this.lastNameInput.classList.remove('error');

        return true;
    }

    showEmailError(message) {
        this.emailError.textContent = message;
        this.emailError.style.display = 'block';
        this.emailInput.classList.add('error');
    }

    showNameError(message) {
        this.nameError.textContent = message;
        this.nameError.style.display = 'block';
        this.nameInput.classList.add('error');
    }

    showLastNameError(message) {
        this.lastNameError.textContent = message;
        this.lastNameError.style.display = 'block';
        this.lastNameInput.classList.add('error');
    }

    showSuccessMessage() {
        const successDiv = document.createElement('div');
        successDiv.className = 'vragenlijst-success-message';
        successDiv.textContent = 'Bedankt! U zal de resultaten in uw mailbox ontvangen.';

        const content = this.shadowRoot.querySelector('.vragenlijst-content');
        content.appendChild(successDiv);

        setTimeout(() => successDiv.remove(), 5000);
    }

    resetForm() {
        this.emailInput.value = '';
        this.nameInput.value = '';
        this.lastNameInput.value = '';
        this.emailInput.classList.remove('error');
        this.nameInput.classList.remove('error');
        this.lastNameInput.classList.remove('error');
        this.emailError.style.display = 'none';
        this.nameError.style.display = 'none';
        this.lastNameError.style.display = 'none';

        const sliders = this.shadowRoot.querySelectorAll('.vragenlijst-slider');
        sliders.forEach((slider) => {
            slider.value = '3';
        });

        this.clearStorage();
    }

    showError(message) {
        console.error(message);
        const container = this.shadowRoot.querySelector('.vragenlijst-container');
        container.innerHTML = `
            <div class="vragenlijst-error">
                ${message}
            </div>
        `;
    }

    getStyles() {
        const accentColor = Vragenlijst.ACCENT_COLOR;
        
        return `
            .vragenlijst-container {
                max-width: 800px;
                margin: 0 auto;
                padding: 24px;
                font-family: "Raleway","sans-serif";
                background: transparent;
            }
            .vragenlijst-loading {
                text-align: center;
                padding: 48px 24px;
                color: #1e1e1e;
                background: white;
                border-radius: 28px;
            }
            .loading-spinner {
                border: 3px solid #e0e0e0;
                border-top: 3px solid ${accentColor};
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 0 auto 16px;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .vragenlijst-content {
                background: white;
                border-radius: 28px;
                padding: 32px;
            }
            .vragenlijst-title {
                color: ${accentColor};
                margin: 0 0 8px 0;
                text-align: center;
                font-family: "Lobster Two","fantasy";
                color: #c4a127;
                font-size: 32px;
                font-weight: 400;
                letter-spacing: 0;
                line-height: 1.2;
            }
            .vragenlijst-description {
                color: #666;
                margin-bottom: 32px;
                text-align: center;
                font-size: 16px;
                font-weight: 400;
            }
            .vragenlijst-question {
                padding: 20px;
                margin-top: 16px;
                background-color: #f8f9fa;
                border-radius: 16px;
                border-left: 4px solid ${accentColor};
                display: flex;
                justify-content: space-between;
                flex-direction: row;
            }
            .vragenlijst-question-text {
                color: #1e1e1e;
                font-weight: 500;
                font-size: 16px;
                line-height: 1.5;
                width:60%;
            }
            .vragenlijst-slider-container {
                width: 40%;
                display: flex;
                flex-direction: column;
            }
            .vragenlijst-slider-labels {
                display: flex;
                justify-content: space-between;
                margin: 0 4px 4px 4px;
                font-size: 14px;
                color: #666;
                font-weight: 500;
                gap: 12px;
            }
            .label-left {
                text-align: left;
            }
            .label-center {
                text-align: center;
            }
            .label-right {
                text-align: right;
            }
            .vragenlijst-slider {
                -webkit-appearance: none;
                appearance: none;
                width: 80%;
                height: 10px;
                background: #e0e0e0;
                border-radius: 20px;
                outline: none;
                margin: 0;
                cursor: pointer;
                align-self: center;
            }
            .vragenlijst-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 20px;
                height: 20px;
                background: ${accentColor};
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                transition: transform 0.1s;
                border: 2px solid white;
            }
            .vragenlijst-slider::-webkit-slider-thumb:hover {
                transform: scale(1.15);
            }
            .vragenlijst-slider::-moz-range-thumb {
                width: 18px;
                height: 18px;
                background: ${accentColor};
                border: 2px solid white;
                border-radius: 50%;
                cursor: pointer;
            }
            .vragenlijst-slider::-moz-range-track {
                height: 4px;
                background: #e0e0e0;
                border-radius: 20px;
            }
            .vragenlijst-double {
                display: flex;
                flex-wrap: wrap;
                flex-direction: row;
                justify-content: space-between;
            }
            .vragenlijst-text-input-section {
                margin: 32px 0 24px;
                padding: 0;
            }
            .vragenlijst-sub {
                margin: 0px;
                width: 45%;
            }
            .vragenlijst-text-input-label {
                display: block;
                margin-bottom: 8px;
                color: #1e1e1e;
                font-weight: 500;
                font-size: 14px;
                letter-spacing: 0.1px;
            }
            .vragenlijst-text-input-input {
                width: 100%;
                padding: 16px;
                border: 1px solid #e0e0e0;
                border-radius: 16px;
                font-size: 16px;
                background: #f8f9fa;
                transition: border 0.2s;
                box-sizing: border-box;
            }
            .vragenlijst-text-input-input:focus {
                border-color: ${accentColor};
                outline: none;
                background: white;
            }
            .vragenlijst-text-input-input.error {
                border-color: #ba1a1a;
            }
            .vragenlijst-text-input-error {
                color: #ba1a1a;
                font-size: 13px;
                margin-top: 4px;
                display: none;
                font-weight: 500;
            }
            .vragenlijst-submit-button {
                width: 100%;
                padding: 16px 24px;
                background: ${accentColor};
                color: white;
                border: none;
                border-radius: 100px;
                font-size: 16px;
                font-weight: 500;
                cursor: pointer;
                transition: background 0.2s;
                text-transform: none;
                letter-spacing: 0.1px;
                line-height: 1;
                margin-top: 16px;
            }
            .vragenlijst-submit-button:disabled {
                opacity: 0.5;
                cursor: default;
                background: ${accentColor};
            }
            .vragenlijst-success-message {
                background: #e8f5e9;
                color: #1e4620;
                padding: 16px;
                border-radius: 16px;
                margin-top: 24px;
                text-align: center;
                border: none;
                font-weight: 500;
                animation: slideIn 0.2s ease;
            }
            .vragenlijst-error {
                background: #ffebee;
                color: #ba1a1a;
                padding: 24px;
                border-radius: 16px;
                text-align: center;
                border: none;
                font-weight: 500;
            }
            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(-5px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            @media (max-width: 768px) {
                .vragenlijst-container {
                    padding: 12px;
                }
                .vragenlijst-content {
                    padding: 20px;
                    border-radius: 20px;
                }
                .vragenlijst-title {
                    font-size: 24px;
                }
                .vragenlijst-question {
                    padding: 16px;
                }
            }
            @media (max-width: 450px) {
                .vragenlijst-text-input-input {
                    padding: 14px;
                }
                .vragenlijst-submit-button {
                    padding: 14px 20px;
                }
                .vragenlijst-question {
                    flex-direction: column;
                }
                .vragenlijst-slider-container {
                    width: 100%;
                }
                .vragenlijst-question-text {
                    width:100%;
                }
                .vragenlijst-double {
                    flex-direction: column;
                }
                .vragenlijst-sub {
                    margin-top: 12px;
                    width: 100%;
                }
            }
        `;
    }
}

if (!customElements.get('vragen-lijst')) {
    customElements.define('vragen-lijst', Vragenlijst);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Vragenlijst;
}