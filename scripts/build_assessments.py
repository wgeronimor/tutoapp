import json
from pathlib import Path

# New situations, separate from daily practice. Five reading and five listening questions per week.
DATA = [
    (
        "Rencontrer un collègue",
        "Bonjour, je m’appelle Rémi. Je viens de France. J’habite à Ottawa. Je parle français et espagnol. Je travaille dans une école.",
        [
            ("Comment s’appelle la personne ?", "Rémi", "Marc"),
            ("D’où vient-elle ?", "De France", "Du Canada"),
            ("Où habite-t-elle ?", "À Ottawa", "À Vancouver"),
            (
                "Quelle langue parle-t-elle avec le français ?",
                "L’espagnol",
                "L’anglais",
            ),
            ("Où travaille-t-elle ?", "Dans une école", "Dans une banque"),
        ],
        "Bonjour ! Je suis Lucia. Mon nom s’écrit L-U-C-I-A. Je viens du Chili. J’ai vingt-neuf ans. Je suis étudiante à Québec. Je parle espagnol et j’apprends le français.",
        [
            ("Quel est le prénom ?", "Lucia", "Louise"),
            ("D’où vient Lucia ?", "Du Chili", "Du Pérou"),
            ("Quel âge a Lucia ?", "Vingt-neuf ans", "Dix-neuf ans"),
            ("Quelle est son activité ?", "Elle est étudiante", "Elle est médecin"),
            ("Où étudie-t-elle ?", "À Québec", "À Toronto"),
        ],
    ),
    (
        "Un nouveau logement",
        "Je m’appelle Benoît. Ma famille compte quatre personnes : mes parents, ma sœur et moi. Mon père est cuisinier. Ma sœur aime lire. Nous habitons dans une maison avec trois chambres.",
        [
            ("Combien de personnes y a-t-il dans la famille ?", "Quatre", "Trois"),
            ("Benoît a-t-il une sœur ?", "Oui", "Non"),
            ("Quelle est la profession du père ?", "Cuisinier", "Professeur"),
            ("Qu’aime faire sa sœur ?", "Lire", "Courir"),
            ("Combien de chambres a la maison ?", "Trois", "Deux"),
        ],
        "À louer : appartement de deux chambres à Laval. La cuisine est grande. Le quartier est calme. Il y a une école près du logement. Pour une visite, appelez vendredi.",
        [
            ("Où est le logement ?", "À Laval", "À Québec"),
            ("Combien de chambres a-t-il ?", "Deux", "Une"),
            ("Comment est la cuisine ?", "Grande", "Petite"),
            ("Qu’y a-t-il près du logement ?", "Une école", "Une gare"),
            ("Quand faut-il appeler ?", "Vendredi", "Samedi"),
        ],
    ),
    (
        "Une sortie en ville",
        "Message de Louis : Rendez-vous devant la mairie samedi. Le café est à gauche de la mairie. Je vais prendre une soupe à neuf dollars et une eau à deux dollars. Après, nous allons à pied au musée.",
        [
            ("Quel jour est le rendez-vous ?", "Samedi", "Dimanche"),
            ("Où est le café ?", "À gauche de la mairie", "À droite de la mairie"),
            ("Combien coûte la soupe ?", "Neuf dollars", "Deux dollars"),
            ("Quelle boisson Louis choisit-il ?", "De l’eau", "Du café"),
            ("Comment vont-ils au musée ?", "À pied", "En bus"),
        ],
        "Pour aller au marché, prenez le bus quarante. Descendez à la deuxième station. Le marché est à droite, près de la poste. Il ouvre à dix heures. Les pommes coûtent quatre dollars le kilo.",
        [
            ("Quel bus faut-il prendre ?", "Le quarante", "Le quatorze"),
            ("À quelle station faut-il descendre ?", "La deuxième", "La première"),
            ("De quel côté est le marché ?", "À droite", "À gauche"),
            ("À quelle heure ouvre-t-il ?", "À dix heures", "À neuf heures"),
            ("Quel est le prix du kilo de pommes ?", "Quatre dollars", "Trois dollars"),
        ],
    ),
    (
        "Un week-end à organiser",
        "Message de Zoé : Samedi, je vais acheter une chemise verte en taille quarante-deux. Elle coûte trente-cinq dollars. Ensuite, je vais visiter mon frère à Longueuil. Dimanche, nous allons étudier chez lui.",
        [
            ("Que va acheter Zoé ?", "Une chemise", "Une veste"),
            ("Quelle couleur a-t-elle choisie ?", "Verte", "Bleue"),
            ("Quelle taille cherche-t-elle ?", "Quarante-deux", "Quarante"),
            (
                "Combien coûte la chemise ?",
                "Trente-cinq dollars",
                "Cinquante-trois dollars",
            ),
            ("Que vont-ils faire dimanche ?", "Étudier", "Aller au marché"),
        ],
        "Bonjour, ici Élodie. Demain, il va neiger et il va faire moins deux degrés à Québec. Prenez un manteau chaud. Nous allons nous retrouver devant la gare à onze heures. Le déjeuner est prévu au restaurant de la place.",
        [
            ("Quel temps est prévu ?", "De la neige", "Du soleil"),
            ("Dans quelle ville ?", "À Québec", "À Montréal"),
            ("Quel vêtement est conseillé ?", "Un manteau chaud", "Un short"),
            ("À quelle heure est le rendez-vous ?", "À onze heures", "À douze heures"),
            ("Où est prévu le déjeuner ?", "Au restaurant de la place", "À la maison"),
        ],
    ),
]
all = []
for week, (title, reading, rq, listening, lq) in enumerate(DATA, 1):
    acts = []
    for skill, material, questions in [
        ("reading", reading, rq),
        ("listening", listening, lq),
    ]:
        for i, (q, a, b) in enumerate(questions):
            acts.append(
                {
                    "key": f"eval:{week}:{skill}:{i}",
                    "title": f"{'Lire' if skill == 'reading' else 'Écouter'} · question {i + 1}",
                    "skill": skill,
                    "mode": "choice",
                    "prompt": q + " Réponds sans aide au premier essai.",
                    "material": material if skill == "reading" else "",
                    "reference": material,
                    "accepted": [a],
                    "options": [a, b] if i % 2 else [b, a],
                    "explanation": "Le message donne cette information : "
                    + a
                    + ". Consulte la référence après ton premier essai.",
                    "item": f"fr:assessment:w{week}:{skill}:{i}",
                    "minutes": 5,
                    "block": "Compréhension · sans aide",
                    "origin": "Évaluation originale · réponses revues",
                }
            )
    for skill in ("writing", "speaking"):
        acts.append(
            {
                "key": f"eval:{week}:{skill}",
                "title": "Production écrite" if skill == "writing" else "Production orale",
                "skill": skill,
                "mode": "open" if skill == "writing" else "speak",
                "prompt": (
                    "Escribe un mensaje de "
                    + str(20 + week * 10)
                    + " palabras para organizar una nueva situación relacionada con «"
                    + title
                    + "»: preséntate, pregunta un dato y propone una alternativa. Usa información distinta a los textos."
                    if skill == "writing"
                    else "Sin leer: preséntate, explica qué quieres hacer y formula dos preguntas sobre «"
                    + title
                    + "». Después responde a una pregunta imprevista de un compañero o cambia un dato."
                ),
                "reference": "",
                "item": f"fr:assessment:w{week}:{skill}",
                "explanation": "Revisa cumplimiento, claridad, vocabulario y autonomía. El modelo ofrece orientación; conserva la revisión de un tutor cuando esté disponible.",
                "minutes": 15,
                "block": "Producción · transferencia",
                "origin": "Evaluación original · rúbrica del curso",
            }
        )
    all.append(
        {
            "week": week,
            "title": "Control semanal " + str(week) + " · " + title,
            "activities": acts,
        }
    )
Path("content/assessments-v1.json").write_text(
    json.dumps({"version": "assessment-1", "weeks": all}, ensure_ascii=False, indent=2) + "\n"
)
