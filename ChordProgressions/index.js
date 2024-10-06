
// Function to display the note information
function displayNote(noteObj, className) {
    const noteElements = document.getElementsByClassName("note-info");
    for (let element of noteElements) {
        element.innerHTML = `Note: ${noteObj.note}, Octave: ${noteObj.octave}, Frequency: ${noteObj.frequency.toFixed(2)} Hz`;
    }

    const button = document.querySelector(`.${className}`);
    button.addEventListener('click', function () {
        // Change the button text to reflect the currently playing note
        this.textContent = `Play ${noteObj.name} + ${noteObj.octave}`; // Update button text
        // Optional: Reset the button text after a delay
        setTimeout(() => {
            this.textContent = `Play ${noteName}`; // Reset text after 1 second
        }, 1000); // 1000 milliseconds = 1 second
});
}


class Note {
    constructor(noteName, className = null) {
        let name = noteName.match(/[a-zA-Z]+/g).join('');
        let octave = parseInt(noteName.match(/\d+/g));

        this.note = name;
        this.octave = octave;
        this.frequency = this.getFrequency();

        displayNote(this, className);
    }

    // Function to calculate frequency for the note
    getFrequency() {
        const noteMap = {
            'C': 0,
            'C#': 1,
            'D': 2,
            'D#': 3,
            'E': 4,
            'F': 5,
            'F#': 6,
            'G': 7,
            'G#': 8,
            'A': 9,
            'A#': 10,
            'B': 11
        };

        // Get the semitone for the note
        let semitone = noteMap[this.note.toUpperCase()];

        // Correct MIDI Note calculation
        let midiNote = 12 * this.octave + semitone; // Corrected the octave usage

        // Calculate frequency using the formula
        let frequency = 440 * Math.pow(2, (midiNote - 69) / 12);
        return frequency;
    }

    // Function to play the note using Web Audio API
    playNote() {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine'; // You can change the type to 'square', 'triangle', etc.
        oscillator.frequency.setValueAtTime(this.frequency, audioCtx.currentTime); // Set frequency
        oscillator.start(); // Start playing the sound

        // Stop the note after 1 second
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 1); // Fade out
        oscillator.stop(audioCtx.currentTime + 1); // Stop after 1 second
    }
}


// Instantiate the Note class for each note
let note1 = new Note("A2", "note1");
let note2 = new Note("A3", "note2");
let note3 = new Note("A4", "note3");

// Add event listeners to the buttons for user gestures
const buttons = document.querySelectorAll('.play-note-btn');
buttons.forEach(button => {
    button.addEventListener('click', function () {
        const noteName = this.getAttribute('data-note'); // Get the note name from data attribute
        const note = new Note(noteName); // Create a new Note object
        note.playNote(); // Play the note when the button is clicked
        
        // Change the button text to reflect the currently playing note
        this.textContent = `Playing ${noteName}`; // Update button text
        // Optional: Reset the button text after a delay
        setTimeout(() => {
            this.textContent = `Play ${noteName}`; // Reset text after 1 second
        }, 1000); // 1000 milliseconds = 1 second
    });
});

