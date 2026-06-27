-- Seed data for local development / demo purposes
-- Video URLs are placeholders — replace with real CDN-hosted sign clips in production.

INSERT INTO sign_dictionary (sign_language, gloss, category, difficulty_level, video_url, instructions_text, handshape_tags) VALUES
('ASL', 'HELLO', 'greetings', 1, '/media/signs/asl/hello.mp4', 'Raise your hand near your forehead and move it outward, like a salute.', ARRAY['open_palm']),
('ASL', 'THANK YOU', 'greetings', 1, '/media/signs/asl/thank_you.mp4', 'Touch fingers to chin, then move hand forward and down.', ARRAY['flat_hand']),
('ASL', 'HELP', 'emergency', 1, '/media/signs/asl/help.mp4', 'Place one fist on the open palm of the other hand, then lift both upward.', ARRAY['fist', 'open_palm']),
('ASL', 'EMERGENCY', 'emergency', 2, '/media/signs/asl/emergency.mp4', 'Shake the letter "E" handshape side to side.', ARRAY['e_hand']),
('ASL', 'DOCTOR', 'emergency', 2, '/media/signs/asl/doctor.mp4', 'Tap the wrist of your flat hand with the fingertips of your other hand.', ARRAY['flat_hand']),
('ISL', 'HELLO', 'greetings', 1, '/media/signs/isl/hello.mp4', 'Open palm near the forehead, move outward and down.', ARRAY['open_palm']),
('ISL', 'THANK YOU', 'greetings', 1, '/media/signs/isl/thank_you.mp4', 'Bring flat hand from chin outward, palm facing up.', ARRAY['flat_hand']),
('ISL', 'HELP', 'emergency', 1, '/media/signs/isl/help.mp4', 'Closed fist tapped on open palm, lifted together.', ARRAY['fist', 'open_palm']),
('BSL', 'HELLO', 'greetings', 1, '/media/signs/bsl/hello.mp4', 'Flat hand near temple, small wave motion outward.', ARRAY['open_palm']),
('BSL', 'THANK YOU', 'greetings', 1, '/media/signs/bsl/thank_you.mp4', 'Fingertips touch chin then move forward.', ARRAY['flat_hand']);

INSERT INTO lessons (sign_language, title, description, difficulty_level, order_index, sign_ids)
SELECT 'ASL', 'ASL Basics: Greetings', 'Learn the most common everyday greetings.', 1, 1,
       ARRAY(SELECT id FROM sign_dictionary WHERE sign_language = 'ASL' AND category = 'greetings');

INSERT INTO lessons (sign_language, title, description, difficulty_level, order_index, sign_ids)
SELECT 'ASL', 'ASL Emergency Signs', 'Critical signs for emergency situations.', 2, 2,
       ARRAY(SELECT id FROM sign_dictionary WHERE sign_language = 'ASL' AND category = 'emergency');

INSERT INTO emergency_phrases (sign_language, phrase_key, display_text_en, translations, icon, priority_order) VALUES
('ASL', 'need_ambulance', 'I need an ambulance', '{"hi": "मुझे एम्बुलेंस चाहिए", "te": "నాకు అంబులెన్స్ కావాలి", "es": "Necesito una ambulancia"}', 'ambulance', 1),
('ASL', 'call_police', 'Please call the police', '{"hi": "कृपया पुलिस को बुलाएं", "te": "దయచేసి పోలీసులకు కాల్ చేయండి", "es": "Por favor llame a la policía"}', 'shield-alert', 2),
('ASL', 'in_pain', 'I am in pain', '{"hi": "मुझे दर्द हो रहा है", "te": "నాకు నొప్పిగా ఉంది", "es": "Tengo dolor"}', 'heart-pulse', 3),
('ASL', 'need_interpreter', 'I need a sign language interpreter', '{"hi": "मुझे संकेत भाषा दुभाषिया चाहिए", "te": "నాకు సంజ్ఞా భాష అనువాదకుడు కావాలి", "es": "Necesito un intérprete de lengua de señas"}', 'message-circle', 4),
('ASL', 'allergic_reaction', 'I am having an allergic reaction', '{"hi": "मुझे एलर्जी हो रही है", "te": "నాకు అలెర్జీ ప్రతిచర్య జరుగుతోంది", "es": "Estoy teniendo una reacción alérgica"}', 'alert-triangle', 5);
