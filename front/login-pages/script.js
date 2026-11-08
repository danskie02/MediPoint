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

    setRole("student");

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

        const existingUser = MediPoint.getUser(userId);
        if(existingUser){
            alert("An account with this ID already exists. Please sign in instead.");
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

        if(typeof window.MediPointKioskApi !== "undefined" &&
           window.MEDIPOINT_SUPABASE_URL &&
           window.MEDIPOINT_SUPABASE_ANON_KEY) {
            try {
                const result = await window.MediPointKioskApi.signUpKioskProfile({
                    ...userData,
                    fullName,
                    userId,
                    programDepartment: programDepartmentValue,
                }, {
                    kioskId: window.MEDIPOINT_KIOSK_ID || ""
                });

                if(result && result.user){
                    createdUser = result.user;
                    if(result.qrPayload){
                        qrPayload = result.qrPayload;
                    }
                }
            } catch (error) {
                console.warn("Supabase kiosk sign-up failed; falling back to local sign-up.", error);
            }
        }

        const finalUser = createdUser || userData;
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

async function continueLogin(){
    const fullNameInput = document.getElementById("fullName2").value.trim();
    const idNumberInput = document.getElementById("idNumber").value.trim();

    if(fullNameInput === "" || idNumberInput === ""){
        alert("Please enter your Full Name and ID Number.");
        return;
    }

    const requestedRole = getRequestedRole();
    let remoteUnavailable = false;

    if(typeof window.MediPointKioskApi !== "undefined" &&
       window.MEDIPOINT_SUPABASE_URL &&
       window.MEDIPOINT_SUPABASE_ANON_KEY) {
        try {
            const result = requestedRole === "doctor"
                ? await window.MediPointKioskApi.portalAuth("login", {
                    name: fullNameInput,
                    idNumber: idNumberInput,
                    role: "doctor"
                }, {
                    kioskId: window.MEDIPOINT_KIOSK_ID || ""
                })
                : await window.MediPointKioskApi.loginWithId(fullNameInput, {
                    idNumber: idNumberInput,
                    requestedRole,
                    kioskId: window.MEDIPOINT_KIOSK_ID || ""
                });

            const savedUser = result && result.user;
            if(savedUser){
                MediPoint.setCurrentUser(savedUser);
                window.location.href = MediPoint.routeFor(savedUser, '../');
                return;
            }

            if(result && result.error){
                alert(result.error);
                return;
            }
        } catch (error) {
            remoteUnavailable = !Number.isInteger(error && error.status);
            console.warn("Supabase login failed; falling back to local login.", error);
        }
    }

    const matchedUser = MediPoint.getUsers().find(user =>
        String(user.name || '').trim().toLowerCase() === fullNameInput.toLowerCase() &&
        String(user.idNumber || '') === idNumberInput &&
        (!requestedRole || user.role === requestedRole)
    ) || null;

    if(!matchedUser){
        alert(remoteUnavailable
            ? "Could not connect to the online login service. Check the internet connection and try again."
            : "Incorrect Full Name or Student Number / Personnel ID.");
        return;
    }

    MediPoint.setCurrentUser(matchedUser);
    window.location.href = MediPoint.routeFor(matchedUser, '../');
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
