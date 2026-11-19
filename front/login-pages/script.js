/* ==========================================================================
   MediPoint — combined script
   Handles: page switching, Sign Up form, ID Login form, QR Login scanning
   ========================================================================== */

/* ---------- Page switching (replaces separate .html files) ---------- */

function showPage(pageId){
    document.querySelectorAll(".page-view").forEach(el => el.classList.add("hidden"));
    document.getElementById(pageId).classList.remove("hidden");

    document.querySelectorAll(".app-nav button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.target === pageId);
    });

    // Re-focus the hidden QR input whenever the QR login page becomes active
    if(pageId === "qrLoginPage"){
        const qrInput = document.getElementById("qrInput");
        if(qrInput) qrInput.focus();
    }
}

function getRequestedRole(){
    const role = new URLSearchParams(window.location.search).get("role");
    return role === "personnel" || role === "student" || role === "doctor" ? role : "";
}

/* ==========================================================================
   Sign Up page logic
   ========================================================================== */

document.addEventListener("DOMContentLoaded", function(){

    MediPoint.ensureClinicalAccount();

    let selectedRole = "student";

    const roleCards = document.querySelectorAll("#signupPage .role-card");
    const programDepartmentLabel = document.getElementById("programDepartmentLabel");
    const programDepartment = document.getElementById("programDepartment");
    const userIdLabel = document.getElementById("userIdLabel");
    const userIdInput = document.getElementById("userId");

    const studentOptions = `
        <option value="" selected disabled>Select your Program</option>
        <option value="BS Computer Engineering">BS Computer Engineering</option>
        <option value="BS Civil Engineering">BS Civil Engineering</option>
        <option value="BS Electrical Engineering">BS Electrical Engineering</option>
        <option value="BS Electronics Engineering">BS Electronics Engineering</option>
        <option value="BS Mechanical Engineering">BS Mechanical Engineering</option>
        <option value="BS Information Technology">BS Information Technology</option>
        <option value="BS Information Systems">BS Information Systems</option>
        <option value="BS Computing Science">BS Computing Science</option>
        <option value="BS Criminology">BS Criminology</option>
        <option value="BS Environmental Science">BS Environmental Science</option>
        <option value="BS Midwifery">BS Midwifery</option>
        <option value="BS Nursing">BS Nursing</option>
    `;

    const personnelOptions = `
        <option value="" selected disabled>Select your Department / Office</option>
        <option value="Clinic">Clinic</option>
        <option value="Registrar">Registrar</option>
        <option value="Accounting Office">Accounting Office</option>
        <option value="Guidance Office">Guidance Office</option>
        <option value="IT Department">IT Department</option>
        <option value="Engineering Department">Engineering Department</option>
        <option value="Nursing Department">Nursing Department</option>
        <option value="Security Office">Security Office</option>
        <option value="Library">Library</option>
        <option value="Administration Office">Administration Office</option>
    `;

    function setRole(role){
        selectedRole = role;

        roleCards.forEach(card => {
            card.classList.toggle("active", card.dataset.role === role);
        });

        programDepartment.value = "";
        userIdInput.value = "";

        if(role === "student"){
            programDepartmentLabel.textContent = "Program *";
            userIdLabel.textContent = "Student Number *";
            programDepartment.innerHTML = studentOptions;
        }else{
            programDepartmentLabel.textContent = "Department / Office *";
            userIdLabel.textContent = "ID Number *";
            programDepartment.innerHTML = personnelOptions;
        }
    }

    roleCards.forEach(card => {
        card.addEventListener("click", function(){
            setRole(this.dataset.role);
        });
    });

    if(programDepartment && userIdInput){
        setRole("student");
    }

    window.generateQR = async function(){
        const fullName = document.getElementById("fullName").value.trim();
        const birthday = document.getElementById("birthday").value.trim();
        const gender = document.getElementById("gender").value;
        const programDepartmentValue = document.getElementById("programDepartment").value;
        const userId = document.getElementById("userId").value.trim();
        const email = document.getElementById("email").value.trim();

        if(fullName === "" || birthday === "" || gender === "" || programDepartmentValue === "" || userId === "" || email === ""){
            alert("Please fill in all required fields.");
            return;
        }

        if(!document.getElementById("email").checkValidity()){
            alert("Please enter a valid email address.");
            return;
        }

        if(new Date(`${birthday}T00:00:00`) > new Date()){
            alert("Birthday cannot be in the future.");
            return;
        }

        if(typeof QRCode === "undefined"){
            alert("QR generator is missing. Check your qrcode.min.js file path.");
            return;
        }

        if(typeof window.MediPointKioskApi === "undefined" ||
           !window.MEDIPOINT_SUPABASE_URL ||
           !window.MEDIPOINT_SUPABASE_ANON_KEY) {
            alert("Online account service is not configured.");
            return;
        }

        const userData = {
            role: selectedRole,
            name: fullName,
            birthday: birthday,
            gender: gender,
            email: email,
            idNumber: userId,
            program: selectedRole === "student" ? programDepartmentValue : "",
            departmentOffice: selectedRole === "personnel" ? programDepartmentValue : "",
            profileComplete: false,
            memberSince: new Date().toISOString()
        };

        let qrPayload = `medipoint:v1:${userId}`;
        let createdUser = null;

        try {
            const result = await window.MediPointKioskApi.signUpKioskProfile({
                ...userData,
                fullName,
                userId,
                programDepartment: programDepartmentValue,
            }, {
                kioskId: window.MEDIPOINT_KIOSK_ID || ""
            });

            if(!(result && result.user)){
                alert((result && result.error) || "Could not create the account online.");
                return;
            }

            createdUser = result.user;
            if(result.qrPayload){
                qrPayload = result.qrPayload;
            }
        } catch (error) {
            alert(Number.isInteger(error && error.status)
                ? (error.message || "Could not create the account online.")
                : "Could not connect to the online account service. Check the internet connection and try again.");
            return;
        }

        const finalUser = {
            ...createdUser,
            idNumber: createdUser.idNumber || userId,
            mustChangePassword: true
        };
        MediPoint.saveUser(finalUser);

        const qrBox = document.getElementById("qrBox");
        qrBox.innerHTML = "";

        try{
            new QRCode(qrBox, {
                text: qrPayload,
                width: 245,
                height: 245
            });
        }catch(error){
            qrBox.innerHTML = '<div class="qr-empty">Unable to generate QR code. Please try again.</div>';
            alert("Unable to generate QR code. Please check the entered details.");
            return;
        }

        document.getElementById("displayRole").textContent =
            "Role: " + (selectedRole === "student" ? "Student" : "Personnel");

        document.getElementById("displayName").textContent =
            "Name: " + fullName;

        document.getElementById("displayId").textContent =
            "ID Number: " + userId;

        document.getElementById("displayRole").classList.remove("hidden");
        document.getElementById("displayName").classList.remove("hidden");
        document.getElementById("displayId").classList.remove("hidden");
    };

});

/* ==========================================================================
   ID Login page logic
   ========================================================================== */

let pendingPasswordChange = null;

function showLoginFields(){
    const loginFields = document.getElementById("loginFields");
    const changeFields = document.getElementById("changePasswordFields");
    const forgotFields = document.getElementById("forgotPasswordFields");
    const subtitle = document.getElementById("loginSubtitle");
    if(loginFields) loginFields.classList.remove("hidden");
    if(changeFields) changeFields.classList.add("hidden");
    if(forgotFields) forgotFields.classList.add("hidden");
    if(subtitle){
        subtitle.textContent = getRequestedRole() === "doctor"
            ? "Enter your full name and password to open the clinical portal"
            : "Enter your full name and password to continue";
    }
}

function showForgotPassword(){
    document.getElementById("loginFields").classList.add("hidden");
    document.getElementById("changePasswordFields").classList.add("hidden");
    document.getElementById("forgotPasswordFields").classList.remove("hidden");
    const identityStep = document.getElementById("forgotIdentityStep");
    const otpStep = document.getElementById("forgotOtpStep");
    if(identityStep) identityStep.classList.remove("hidden");
    if(otpStep) otpStep.classList.add("hidden");
    const subtitle = document.getElementById("loginSubtitle");
    if(subtitle) subtitle.textContent = "Confirm your account details to receive an email verification code";
}

function showPasswordChange(user, currentPassword){
    pendingPasswordChange = { user, currentPassword, name: user.name };
    document.getElementById("loginFields").classList.add("hidden");
    document.getElementById("forgotPasswordFields").classList.add("hidden");
    document.getElementById("changePasswordFields").classList.remove("hidden");
    const subtitle = document.getElementById("loginSubtitle");
    if(subtitle) subtitle.textContent = "Choose a password only you know";
    const field = document.getElementById("newPassword");
    if(field) field.focus();
}

function openSignedInAccount(user){
    MediPoint.setCurrentUser({ ...user, mustChangePassword: false });
    window.location.href = MediPoint.routeFor(user, '../');
}

function onlineAuthError(){
    if(typeof window.MediPointKioskApi === "undefined" ||
       !window.MEDIPOINT_SUPABASE_URL ||
       !window.MEDIPOINT_SUPABASE_ANON_KEY) {
        return "Online account service is not configured.";
    }
    return "";
}

async function continueLogin(){
    const fullNameInput = document.getElementById("fullName2").value.trim();
    const passwordInput = document.getElementById("password").value;

    if(fullNameInput === "" || passwordInput === ""){
        alert("Please enter your full name and password.");
        return;
    }

    const configError = onlineAuthError();
    if(configError){
        alert(configError);
        return;
    }

    const requestedRole = getRequestedRole();

    try {
        const result = requestedRole === "doctor"
            ? await window.MediPointKioskApi.portalAuth("login", {
                name: fullNameInput,
                password: passwordInput,
                idNumber: passwordInput,
                role: "doctor"
            }, {
                kioskId: window.MEDIPOINT_KIOSK_ID || ""
            })
            : await window.MediPointKioskApi.loginWithId(fullNameInput, {
                password: passwordInput,
                requestedRole,
                kioskId: window.MEDIPOINT_KIOSK_ID || ""
            });

        const savedUser = result && result.user;
        if(savedUser){
            if(result.mustChangePassword || savedUser.mustChangePassword){
                showPasswordChange(savedUser, passwordInput);
                return;
            }
            openSignedInAccount(savedUser);
            return;
        }

        alert((result && result.error) || "Incorrect full name or password.");
    } catch (error) {
        alert(Number.isInteger(error && error.status)
            ? (error.message || "Incorrect full name or password.")
            : "Could not connect to the online login service. Check the internet connection and try again.");
    }
}

async function submitPasswordChange(){
    const pending = pendingPasswordChange;
    if(!pending){
        showLoginFields();
        return;
    }

    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    if(newPassword !== confirmPassword){
        alert("Passwords do not match.");
        return;
    }

    const ruleError = MediPoint.newPasswordError(newPassword, MediPoint.getPublicIdNumber(pending.user));
    if(ruleError){
        alert(ruleError);
        return;
    }

    const configError = onlineAuthError();
    if(configError){
        alert(configError);
        return;
    }

    try{
        const result = await window.MediPointKioskApi.portalAuth("change-password", {
            name: pending.name,
            currentPassword: pending.currentPassword,
            newPassword
        }, {
            kioskId: window.MEDIPOINT_KIOSK_ID || ""
        });
        if(result && result.error){
            alert(result.error);
            return;
        }
        if(!(result && result.passwordUpdated && result.user)){
            alert("Could not save the new password online.");
            return;
        }

        pendingPasswordChange = null;
        openSignedInAccount({ ...result.user, mustChangePassword: false });
    }catch(error){
        alert(Number.isInteger(error && error.status)
            ? (error.message || "Could not change the password.")
            : "Could not connect to the online account service. Check the internet connection and try again.");
    }
}

let forgotOtpPending = null;

async function requestForgotPasswordOtp(){
    const name = document.getElementById("forgotName").value.trim();
    const idNumber = document.getElementById("forgotId").value.trim();
    const email = MediPoint.normalizeEmail(document.getElementById("forgotEmail").value);

    if(!name || !idNumber || !email){
        alert("Enter your full name, ID number, and email.");
        return;
    }

    const configError = onlineAuthError();
    if(configError){
        alert(configError);
        return;
    }

    try{
        const result = await window.MediPointKioskApi.portalAuth("forgot-password-request", {
            name,
            idNumber,
            email
        }, {
            kioskId: window.MEDIPOINT_KIOSK_ID || ""
        });
        if(result && result.error){
            alert(result.error);
            return;
        }
        if(!(result && result.otpSent)){
            alert("Could not send the verification code.");
            return;
        }

        forgotOtpPending = { name, idNumber, email };
        document.getElementById("forgotIdentityStep").classList.add("hidden");
        document.getElementById("forgotOtpStep").classList.remove("hidden");
        const subtitle = document.getElementById("loginSubtitle");
        if(subtitle) subtitle.textContent = "Enter the email code and choose a new password";
        alert(result.message || "Verification code sent. Check your email.");
    }catch(error){
        alert(Number.isInteger(error && error.status)
            ? (error.message || "Those account details do not match our records.")
            : "Could not connect to the online account service. Check the internet connection and try again.");
    }
}

async function confirmForgotPasswordOtp(){
    const pending = forgotOtpPending;
    if(!pending){
        showForgotPassword();
        return;
    }

    const code = document.getElementById("forgotOtp").value.trim();
    const newPassword = document.getElementById("forgotNewPassword").value;
    const confirmPassword = document.getElementById("forgotConfirmPassword").value;

    if(!code){
        alert("Enter the verification code from your email.");
        return;
    }
    if(newPassword !== confirmPassword){
        alert("Passwords do not match.");
        return;
    }
    const ruleError = MediPoint.newPasswordError(newPassword, pending.idNumber);
    if(ruleError){
        alert(ruleError);
        return;
    }

    const configError = onlineAuthError();
    if(configError){
        alert(configError);
        return;
    }

    try{
        const result = await window.MediPointKioskApi.portalAuth("forgot-password-confirm", {
            name: pending.name,
            idNumber: pending.idNumber,
            email: pending.email,
            code,
            newPassword
        }, {
            kioskId: window.MEDIPOINT_KIOSK_ID || ""
        });
        if(result && result.error){
            alert(result.error);
            return;
        }
        if(!(result && result.passwordUpdated && result.user)){
            alert("Could not reset the password online.");
            return;
        }

        forgotOtpPending = null;
        openSignedInAccount({ ...result.user, mustChangePassword: false });
    }catch(error){
        alert(Number.isInteger(error && error.status)
            ? (error.message || "Could not verify the code.")
            : "Could not connect to the online account service. Check the internet connection and try again.");
    }
}

/* ==========================================================================
   QR Login page logic
   ========================================================================== */

document.addEventListener("DOMContentLoaded", function(){

    const qrInput = document.getElementById("qrInput");
    const statusMessage = document.getElementById("statusMessage");
    const scanText = document.getElementById("scanText");
    const scanSubtext = document.getElementById("scanSubtext");

    if(!qrInput) return;

    document.addEventListener("click", () => {
        const qrPage = document.getElementById("qrLoginPage");
        if(qrPage && !qrPage.classList.contains("hidden")){
            qrInput.focus();
        }
    });

    qrInput.addEventListener("keydown", function(e){
        if(e.key === "Enter"){
            e.preventDefault();
            void processQRCode();
        }
    });

    let qrLoginInProgress = false;

    async function processQRCode(){
        if(qrLoginInProgress){
            return;
        }

        const qrData = qrInput.value.trim();

        if(qrData === ""){
            showError("Please scan your QR code first.");
            qrInput.focus();
            return;
        }

        if(typeof MediPointKioskApi === "undefined"){
            showError("Kiosk API is not loaded. Check medipoint-config.js and kiosk-api.js.");
            return;
        }

        qrLoginInProgress = true;
        scanText.textContent = "QR Code Detected";
        scanSubtext.textContent = "Verifying account...";
        statusMessage.textContent = "Contacting MediPoint server...";
        statusMessage.className = "status-message";

        try {
            const result = await MediPointKioskApi.loginWithQrCode(qrData, {
                requestedRole: getRequestedRole(),
                kioskId: window.MEDIPOINT_KIOSK_ID || ""
            });

            const savedUser = result.user;
            MediPoint.setCurrentUser(savedUser);

            scanText.textContent = "QR Code Detected";
            scanSubtext.textContent = savedUser.name + " • " + savedUser.idNumber;
            statusMessage.textContent = "Account verified. Redirecting...";
            statusMessage.className = "status-message status-success";

            setTimeout(() => {
                window.location.href = MediPoint.routeFor(savedUser, '../');
            }, 800);
        } catch (error) {
            showError(error.message || "QR login failed. Please try again.");
            qrInput.value = "";
            qrInput.focus();
        } finally {
            qrLoginInProgress = false;
        }
    }

    function showError(message){
        scanText.textContent = "Ready to Scan";
        scanSubtext.textContent = "Place your QR code in front of the scanner";

        statusMessage.textContent = message;
        statusMessage.className = "status-message status-error";
    }

    // Expose for the keydown handler above (kept local otherwise)
    window.__qrProcess = processQRCode;
});
