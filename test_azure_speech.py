import os
from dotenv import load_dotenv
import azure.cognitiveservices.speech as speechsdk

load_dotenv() # Load environment variables from .env file

# Replace with your actual Speech Key and Region from .env or Azure Portal
speech_key = os.environ.get("AZURE_SPEECH_KEY")
service_region = os.environ.get("AZURE_SPEECH_REGION")
azure_endpoint = os.environ.get("AZURE_ENDPOINT") # Get the endpoint

if not speech_key or not service_region:
    print("Please set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables.")
    exit()

print(f"Testing with Key: {speech_key[:5]}... Region: {service_region}")
if azure_endpoint:
    print(f"Using custom endpoint: {azure_endpoint}")

try:
    if azure_endpoint:
        speech_config = speechsdk.SpeechConfig(subscription=speech_key, endpoint=azure_endpoint)
    else:
        speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=service_region)
    # We don't need to actually transcribe, just initializing should indicate if credentials are valid
    # If the key/region are invalid, this often throws an exception or causes connection issues later.
    # For a basic check, we'll just try to create a recognizer.
    # audio_config = speechsdk.audio.AudioConfig(use_default_microphone=False) # บรรทัดเดิมที่ทำให้เกิดข้อผิดพลาด
    # เพื่อทดสอบ credentials โดยไม่ต้องใช้ไมโครโฟนหรือไฟล์จริง
    stream = speechsdk.audio.PushAudioInputStream()
    audio_config = speechsdk.audio.AudioConfig(stream=stream)
    speech_recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)

    print("Azure SpeechConfig and SpeechRecognizer initialized successfully.")
    print("This indicates your SPEECH_KEY and SPEECH_REGION are likely valid.")

    # Optional: You can try to start a recognition, which would more fully test the connection
    # But for a credential check, successful initialization is often enough.
    # print("Attempting to start continuous recognition (this will timeout without audio)...")
    # speech_recognizer.start_continuous_recognition_async()
    # print("Continuous recognition started.")
    # # In a real app, you'd add event handlers and stop it after some time or on an event
    # # For this test, we just let it initialize.
    # speech_recognizer.stop_continuous_recognition_async()

except Exception as e:
    print(f"An error occurred: {e}")
    print("This likely indicates an issue with your SPEECH_KEY or SPEECH_REGION.")