import { Strings } from '../consts';
import * as common from '../common';
import { Session, IDialogResult, Library, AttachmentLayout, HeroCard, CardImage, Message } from 'botbuilder';
import { RawLocation, Address } from '../rawLocation';
import { MapCard } from '../map-card';
import * as locationService from '../services/bing-geospatial-service';
import * as confirmDialog from './confirm-dialog';

export function register(library: Library, apiKey: string): void {
    library.dialog('retrieve-facebook-location-dialog', createDialog(apiKey));
    library.dialog('resolve-facebook-location-dialog', createLocationResolveDialog(apiKey));
}

function createDialog(apiKey: string) {
    return [
        (session: Session, args: any) => {
            session.dialogData.args = args;
            session.beginDialog('resolve-facebook-location-dialog', { prompt: args.prompt });
        },
        (session: Session, results: IDialogResult<any>, next: (results?: IDialogResult<any>) => void) => {
            session.dialogData.response = results.response;
            if (session.dialogData.args.reverseGeocode && results.response && results.response.place) {
                locationService.getLocationByPoint(apiKey, results.response.place.point.coordinates[0], results.response.place.point.coordinates[1])
                    .then(locations => {
                        let place: RawLocation;
                        if (locations.length && locations[0].address) {
                            // We don't trust reverse geo-coder on the street address level.
                            // So, copy all fields except it.
                            let address: Address = {
                                addressLine : undefined,
                                formattedAddress: undefined,
                                adminDistrict : locations[0].address.adminDistrict,
                                adminDistrict2 : locations[0].address.adminDistrict2,
                                countryRegion : locations[0].address.countryRegion,
                                locality : locations[0].address.locality,
                                postalCode : locations[0].address.postalCode
                            };
                            place = { address: address, bbox: locations[0].bbox, confidence: locations[0].confidence, entityType: locations[0].entityType, name: locations[0].name, point: locations[0].point };
                        } else {
                            place = results.response.place;
                        }

                        session.endDialogWithResult({ response: { place: place } });
                    })
                    .catch(error => session.error(error));;
            }
            else if (results.response && results.response.locations) {
                var locations = results.response.locations;
                if (locations.length == 1) {
                    session.beginDialog('confirm-dialog', { locations: locations });
                }
                else {
                    session.beginDialog('choice-dialog', { locations: locations });
                }
            }
            else {
                next(results);
            }
        }
    ];
}

var MAX_CARD_COUNT = 5;
function createLocationResolveDialog(apiKey: string) {
    return common.createBaseDialog()
        .onBegin(function (session, args) {
            session.dialogData.args = args;
            var promptSuffix = session.gettext(Strings.TitleSuffixFacebook);
            sendLocationPrompt(session, session.dialogData.args.prompt + promptSuffix).sendBatch();
        }).onDefault((session) => {
            var entities = session.message.entities;
            for (var i = 0; i < entities.length; i++) {
                if (entities[i].type == "Place" && entities[i].geo && entities[i].geo.latitude && entities[i].geo.longitude) {
                    session.endDialogWithResult({ response: { place: buildLocationFromGeo(Number(entities[i].geo.latitude), Number(entities[i].geo.longitude)) } });
                    return;
                }
            }

            var searchString = session.message.text;
            locationService.getLocationByQuery(apiKey, searchString, session.dialogData.locationQueryOptions.countryCode).then(function (locations: Array<any>) {
                if (locations.length == 0) {
                    session.send(Strings.LocationNotFound).sendBatch();
                    return;
                }
                var locationCount = Math.min(MAX_CARD_COUNT, locations.length);
                locations = locations.slice(0, locationCount);
                var reply = createLocationsCard(apiKey, session, locations);
                session.send(reply);
                session.endDialogWithResult({ response: { locations: locations } });
            })
            .catch(function (error: any) { return session.error(error); });
        });
}

function sendLocationPrompt(session: Session, prompt: string): Session {
    var message = new Message(session).text(prompt).sourceEvent({
        facebook: {
            quick_replies: [
                {
                    content_type: "location"
                }
            ]
        }
    });

    return session.send(message);
}

function createLocationsCard(apiKey: string, session: Session, locations: any) {
    var cards = new Array();

    for (var i = 0; i < locations.length; i++) {
        cards.push(constructCard(apiKey, session, locations, i));
    }

    return new Message(session)
        .attachmentLayout(AttachmentLayout.carousel)
        .attachments(cards);
}

function constructCard(apiKey: string, session: Session, locations: Array<any>, index: number): HeroCard {
    var location = locations[index];
    var card = new MapCard(apiKey, session);

    if (locations.length > 1) {
        card.location(location, index + 1);
    }
    else {
        card.location(location);
    }

    return card;
}

function buildLocationFromGeo(latitude: number, longitude: number) {
    let coordinates = [ latitude, longitude ];
    return { point : { coordinates : coordinates }, address : {} };
}
