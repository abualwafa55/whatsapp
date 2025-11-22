"""
WhatsApp Desktop Application using Python
Communicates with Baileys API in the background
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import requests
import threading
import time
import json
import subprocess
import os
import base64
from io import BytesIO
from PIL import Image, ImageTk

class WhatsAppApp:
    def __init__(self, root):
        self.root = root
        self.root.title("WhatsApp Manager - Python Desktop App")
        self.root.geometry("900x700")
        self.root.configure(bg="#f0f0f0")
        
        self.api_url = "http://localhost:3000/api"
        self.current_session = None
        self.baileys_process = None
        
        self.start_baileys_server()
        self.create_ui()
        self.check_status_loop()
    
    def start_baileys_server(self):
        try:
            response = requests.get(f"{self.api_url}/sessions", timeout=2)
            print("Baileys server is already running")
        except:
            print("Starting Baileys server...")
            server_path = os.path.join(os.path.dirname(__file__), "baileys-server")
            if os.path.exists(os.path.join(server_path, "server.js")):
                self.baileys_process = subprocess.Popen(
                    ["node", "server.js"],
                    cwd=server_path,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                time.sleep(3)
    
    def create_ui(self):
        main_frame = tk.Frame(self.root, bg="#128C7E", padx=20, pady=10)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        title = tk.Label(main_frame, text="📱 WhatsApp Session Manager", font=("Arial", 24, "bold"), bg="#128C7E", fg="white")
        title.pack(pady=10)
        
        session_frame = tk.LabelFrame(main_frame, text="Create New Session", font=("Arial", 12, "bold"), bg="white", padx=15, pady=15)
        session_frame.pack(fill=tk.X, pady=10)
        
        tk.Label(session_frame, text="Session ID:", bg="white", font=("Arial", 10)).grid(row=0, column=0, sticky="w", pady=5)
        self.session_id_entry = tk.Entry(session_frame, width=30, font=("Arial", 10))
        self.session_id_entry.grid(row=0, column=1, padx=10, pady=5)
        
        self.create_btn = tk.Button(session_frame, text="Create Session", command=self.create_session, bg="#25D366", fg="white", font=("Arial", 10, "bold"), padx=20, pady=5)
        self.create_btn.grid(row=0, column=2, padx=10, pady=5)
        
        self.qr_frame = tk.LabelFrame(main_frame, text="QR Code for Scanning", font=("Arial", 12, "bold"), bg="white", padx=15, pady=15)
        self.qr_frame.pack(fill=tk.BOTH, expand=True, pady=10)
        
        self.qr_label = tk.Label(self.qr_frame, text="Create a session first", bg="white", font=("Arial", 12))
        self.qr_label.pack(pady=20)
        
        # Add QR image label
        self.qr_image_label = tk.Label(self.qr_frame, bg="white")
        self.qr_image_label.pack(pady=10)
        
        self.status_label = tk.Label(self.qr_frame, text="⚪ Disconnected", bg="white", font=("Arial", 11, "bold"), fg="gray")
        self.status_label.pack(pady=5)
        
        msg_frame = tk.LabelFrame(main_frame, text="Send Message", font=("Arial", 12, "bold"), bg="white", padx=15, pady=15)
        msg_frame.pack(fill=tk.X, pady=10)
        
        tk.Label(msg_frame, text="Phone Number:", bg="white", font=("Arial", 10)).grid(row=0, column=0, sticky="w", pady=5)
        self.phone_entry = tk.Entry(msg_frame, width=25, font=("Arial", 10))
        self.phone_entry.grid(row=0, column=1, padx=10, pady=5)
        self.phone_entry.insert(0, "962791234567")
        
        tk.Label(msg_frame, text="Message:", bg="white", font=("Arial", 10)).grid(row=1, column=0, sticky="nw", pady=5)
        self.message_text = scrolledtext.ScrolledText(msg_frame, width=40, height=3, font=("Arial", 10))
        self.message_text.grid(row=1, column=1, padx=10, pady=5)
        
        self.send_btn = tk.Button(msg_frame, text="Send 📤", command=self.send_message, bg="#34B7F1", fg="white", font=("Arial", 10, "bold"), padx=20, pady=5, state=tk.DISABLED)
        self.send_btn.grid(row=1, column=2, padx=10, pady=5)
        
        log_frame = tk.LabelFrame(main_frame, text="Event Log", font=("Arial", 12, "bold"), bg="white", padx=15, pady=10)
        log_frame.pack(fill=tk.BOTH, expand=True, pady=10)
        
        self.log_text = scrolledtext.ScrolledText(log_frame, width=80, height=8, font=("Courier", 9), bg="#f9f9f9")
        self.log_text.pack(fill=tk.BOTH, expand=True)
    
    def log(self, message):
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
    
    def create_session(self):
        session_id = self.session_id_entry.get().strip()
        if not session_id:
            messagebox.showwarning("Warning", "Please enter session ID")
            return
        
        self.current_session = session_id
        self.create_btn.config(state=tk.DISABLED)
        self.log(f"Creating session: {session_id}")
        
        def create():
            try:
                response = requests.post(f"{self.api_url}/create-session", json={"sessionId": session_id}, timeout=10)
                if response.status_code == 200:
                    self.log("Session created successfully")
                    self.log("Waiting for QR Code scan...")
                    self.qr_label.config(text="Loading QR Code...")
                    self.check_qr_code()
                else:
                    self.log(f"Error: {response.json().get('error', 'Unknown error')}")
                    self.create_btn.config(state=tk.NORMAL)
            except Exception as e:
                self.log(f"Connection error: {str(e)}")
                self.create_btn.config(state=tk.NORMAL)
        
        threading.Thread(target=create, daemon=True).start()
    
    def check_qr_code(self):
        if not self.current_session:
            return
        
        def check():
            try:
                response = requests.get(f"{self.api_url}/qr/{self.current_session}", timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    qr_image = data.get("qrImage")
                    if qr_image:
                        self.display_qr_image(qr_image)
                    else:
                        # Retry if image not ready yet
                        self.root.after(1000, self.check_qr_code)
                else:
                    self.root.after(2000, self.check_qr_code)
            except:
                self.root.after(2000, self.check_qr_code)
        
        threading.Thread(target=check, daemon=True).start()
    
    def display_qr_image(self, qr_data_url):
        """Display QR Code as image"""
        try:
            # Extract base64 data from data URL
            if qr_data_url.startswith('data:image'):
                qr_base64 = qr_data_url.split(',')[1]
            else:
                qr_base64 = qr_data_url
            
            # Decode base64 to image
            image_data = base64.b64decode(qr_base64)
            image = Image.open(BytesIO(image_data))
            
            # Convert to PhotoImage
            photo = ImageTk.PhotoImage(image)
            
            # Update label
            self.qr_image_label.config(image=photo)
            self.qr_image_label.image = photo  # Keep reference
            
            self.qr_label.config(
                text="📱 Scan this QR Code with WhatsApp\n⏰ Code expires in 60 seconds",
                font=("Arial", 11, "bold"),
                fg="#128C7E"
            )
            self.log("✅ QR Code ready! Scan it now")
            
        except Exception as e:
            self.log(f"❌ Error displaying QR: {str(e)}")
            self.qr_label.config(text=f"Error loading QR Code\n{str(e)}")
    
    def display_qr_code(self, qr_text):
        """Fallback: Display QR Code as text (not used anymore)"""
        self.qr_label.config(text=f"Scan this code in WhatsApp:\n\n{qr_text}", font=("Courier", 8), justify=tk.LEFT)
    
    def check_status_loop(self):
        if not self.current_session:
            self.root.after(3000, self.check_status_loop)
            return
        
        def check():
            try:
                response = requests.get(f"{self.api_url}/status/{self.current_session}", timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("connected"):
                        self.status_label.config(text="🟢 Connected", fg="green")
                        self.send_btn.config(state=tk.NORMAL)
                        self.log("✅ Connected successfully!")
                        
                        # Clear QR Code
                        self.qr_image_label.config(image='')
                        self.qr_label.config(
                            text="✅ Scan successful!\nAccount is now connected",
                            font=("Arial", 12, "bold"),
                            fg="green"
                        )
                    else:
                        self.status_label.config(text="🟡 Waiting for scan...", fg="orange")
            except:
                pass
        
        threading.Thread(target=check, daemon=True).start()
        self.root.after(3000, self.check_status_loop)
    
    def send_message(self):
        phone = self.phone_entry.get().strip()
        message = self.message_text.get("1.0", tk.END).strip()
        if not phone or not message:
            messagebox.showwarning("Warning", "Please enter phone number and message")
            return
        
        self.log(f"Sending message to {phone}...")
        
        def send():
            try:
                response = requests.post(f"{self.api_url}/send-message", json={"sessionId": self.current_session, "number": phone, "message": message}, timeout=10)
                if response.status_code == 200:
                    self.log(f"Message sent successfully to {phone}")
                    self.message_text.delete("1.0", tk.END)
                else:
                    self.log(f"Send failed: {response.json().get('error')}")
            except Exception as e:
                self.log(f"Error: {str(e)}")
        
        threading.Thread(target=send, daemon=True).start()
    
    def on_closing(self):
        if self.baileys_process:
            self.baileys_process.terminate()
        self.root.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    app = WhatsAppApp(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()